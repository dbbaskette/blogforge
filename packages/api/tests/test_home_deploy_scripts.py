from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[3]


def _git(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


@pytest.fixture
def deploy_repo(tmp_path: Path) -> tuple[Path, dict[str, str], Path]:
    origin = tmp_path / "origin.git"
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
    subprocess.run(["git", "init", "-b", "main", str(repo)], check=True, capture_output=True)
    _git(repo, "config", "user.email", "deploy-test@example.com")
    _git(repo, "config", "user.name", "Deploy Test")
    (repo / "tracked.txt").write_text("initial\n")
    _git(repo, "add", "tracked.txt")
    _git(repo, "commit", "-m", "initial")
    _git(repo, "remote", "add", "origin", str(origin))
    _git(repo, "push", "-u", "origin", "main")

    scripts = repo / "scripts"
    scripts.mkdir()
    for name in ("deploy-home.sh", "rollback-home.sh"):
        source = ROOT / "scripts" / name
        if source.exists():
            target = scripts / name
            target.write_text(source.read_text())
            target.chmod(0o755)

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    ssh_log = tmp_path / "ssh.log"
    ssh = fake_bin / "ssh"
    ssh.write_text(
        "#!/bin/bash\n"
        "set -e\n"
        'printf "%s\\n" "$*" >> "$SSH_LOG"\n'
        'if [ "$*" = "-o BatchMode=yes -o ConnectTimeout=10 '
        'blogforge-home true" ]; then exit 0; fi\n'
        'if [ "${SSH_EXECUTE:-0}" = 1 ]; then tee "$SSH_STDIN" | /bin/bash -s; exit $?; fi\n'
        'cat > "$SSH_STDIN"\n'
        'if [ "${SSH_FAIL:-0}" = 1 ]; then echo "remote failed" >&2; exit 9; fi\n'
        'printf "%b\\n" "${SSH_RESULT}"\n'
    )
    ssh.chmod(0o755)

    curl = fake_bin / "curl"
    curl.write_text('#!/bin/bash\nprintf "%s" "${PUBLIC_HEALTH}"\n')
    curl.chmod(0o755)

    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{fake_bin}:{env['PATH']}",
            "BLOGFORGE_SSH": str(ssh),
            "BLOGFORGE_CURL": str(curl),
            "BLOGFORGE_SSH_KEY": str(tmp_path / "deploy-key"),
            "SSH_LOG": str(ssh_log),
            "SSH_STDIN": str(tmp_path / "ssh-stdin.sh"),
            "SSH_RESULT": (
                "BLOGFORGE_DEPLOY_RESULT\\toldsha\\t"
                f"{_git(repo, 'rev-parse', 'HEAD')}\\t0.6.4\\t"
                '{"status":"ok","version":"0.6.4"}'
            ),
            "PUBLIC_HEALTH": '{"status":"ok","version":"0.6.4"}',
        }
    )
    Path(env["BLOGFORGE_SSH_KEY"]).write_text("test key placeholder\n")
    return repo, env, ssh_log


def _run(repo: Path, env: dict[str, str], script: str, *args: str, input: str = ""):
    return subprocess.run(
        ["/bin/bash", str(repo / "scripts" / script), *args],
        cwd=repo,
        env=env,
        input=input,
        capture_output=True,
        text=True,
        check=False,
    )


def _remote_clone(repo: Path, env: dict[str, str]) -> Path:
    remote = repo.parent / "remote"
    subprocess.run(
        ["git", "clone", str(repo.parent / "origin.git"), str(remote)],
        check=True,
        capture_output=True,
    )
    _git(remote, "config", "user.email", "remote-test@example.com")
    _git(remote, "config", "user.name", "Remote Test")
    scripts = remote / "scripts"
    scripts.mkdir(exist_ok=True)
    redeploy = scripts / "redeploy.sh"
    redeploy.write_text('#!/bin/bash\n[ "${REMOTE_REDEPLOY_FAIL:-0}" != 1 ]\n')
    redeploy.chmod(0o755)
    version = scripts / "version.sh"
    version.write_text("#!/bin/bash\necho 0.6.4\n")
    version.chmod(0o755)
    env.update(
        {
            "BLOGFORGE_REMOTE_DIR": str(remote),
            "SSH_EXECUTE": "1",
            "PUBLIC_HEALTH": '{"status":"ok","version":"0.6.4"}',
        }
    )
    return remote


def test_deploy_refuses_non_main_branch(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    _git(repo, "checkout", "-b", "feature")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "requires local branch main" in result.stderr
    assert not ssh_log.exists()


def test_deploy_refuses_tracked_local_changes(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    (repo / "tracked.txt").write_text("dirty\n")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "tracked local changes" in result.stderr
    assert not ssh_log.exists()


def test_deploy_refuses_head_not_on_origin_main(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    (repo / "tracked.txt").write_text("ahead\n")
    _git(repo, "add", "tracked.txt")
    _git(repo, "commit", "-m", "ahead")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "does not match origin/main" in result.stderr
    assert not ssh_log.exists()


def test_deploy_sends_safe_remote_program_and_reports_health(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    # Copying the script after the fixture's initial commit must not make tracked state dirty.
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode == 0, result.stderr
    remote = Path(env["SSH_STDIN"]).read_text()
    for required in (
        "git diff --quiet",
        "git diff --cached --quiet",
        "git fetch origin main",
        "git merge-base --is-ancestor",
        "git merge --ff-only origin/main",
        "scripts/redeploy.sh --sync",
        "http://127.0.0.1:7880/api/health",
    ):
        assert required in remote
    for forbidden in ("reset --hard", "git clean", ".env.public", "BEGIN OPENSSH PRIVATE KEY"):
        assert forbidden not in remote
    assert "deployed SHA" in result.stdout
    assert "public health" in result.stdout


def test_deploy_propagates_remote_failure_without_public_curl(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    env["SSH_FAIL"] = "1"
    env["PUBLIC_HEALTH"] = "PUBLIC_CURL_SHOULD_NOT_RUN"
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "remote failed" in result.stderr
    assert "remote deploy failed (status 9)" in result.stderr
    assert "PUBLIC_CURL_SHOULD_NOT_RUN" not in result.stdout


def test_deploy_refuses_missing_dedicated_key(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    Path(env["BLOGFORGE_SSH_KEY"]).unlink()
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "dedicated SSH key is missing" in result.stderr
    assert not ssh_log.exists()


def test_rollback_requires_exact_confirmation(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    result = _run(repo, env, "rollback-home.sh", "HEAD", input="no\n")
    assert result.returncode != 0
    assert "rollback cancelled" in result.stderr
    assert ssh_log.read_text().splitlines() == [
        "-o BatchMode=yes -o ConnectTimeout=10 blogforge-home true"
    ]


def test_rollback_yes_sends_reachable_detached_redeploy_program(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    env["SSH_RESULT"] = (
        "BLOGFORGE_ROLLBACK_RESULT\\tnewsha\\toldsha\\t0.6.3\\t"
        '{"status":"ok","version":"0.6.3"}'
    )
    env["PUBLIC_HEALTH"] = '{"status":"ok","version":"0.6.3"}'
    result = _run(repo, env, "rollback-home.sh", "--yes", "HEAD")
    assert result.returncode == 0, result.stderr
    remote = Path(env["SSH_STDIN"]).read_text()
    assert 'git rev-parse --verify "$revision^{commit}"' in remote
    assert 'git merge-base --is-ancestor "$rollback_sha" origin/main' in remote
    assert 'git checkout --detach "$rollback_sha"' in remote
    assert "scripts/redeploy.sh --sync" in remote
    assert "rollback SHA" in result.stdout


def test_rollback_metacharacters_never_enter_remote_command(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    env["SSH_FAIL"] = "1"
    revision = "HEAD; touch /tmp/unsafe $(id) ' quoted"
    result = _run(repo, env, "rollback-home.sh", "--yes", revision)
    assert result.returncode != 0
    command_lines = ssh_log.read_text().splitlines()
    assert command_lines[-1].endswith("blogforge-home bash -s")
    assert revision not in command_lines[-1]
    remote = Path(env["SSH_STDIN"]).read_text()
    assert revision not in remote
    assert "REVISION_B64=" in remote


def test_remote_program_has_failure_sha_diagnostics(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    env["SSH_FAIL"] = "1"
    _run(repo, env, "deploy-home.sh")
    remote = Path(env["SSH_STDIN"]).read_text()
    assert "BLOGFORGE_DEPLOY_FAILURE" in remote
    assert "previous_sha" in remote
    assert "deployed_sha" in remote
    assert "launchctl print" in remote


def test_deploy_executes_remote_program_and_preserves_untracked_files(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    (remote / ".python-version").write_text("3.12\n")
    (repo / "tracked.txt").write_text("release\n")
    _git(repo, "add", "tracked.txt")
    _git(repo, "commit", "-m", "release")
    _git(repo, "push", "origin", "main")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode == 0, result.stderr
    assert _git(remote, "rev-parse", "HEAD") == _git(repo, "rev-parse", "HEAD")
    assert (remote / ".python-version").read_text() == "3.12\n"
    assert "deployed SHA" in result.stdout


def test_deploy_executable_remote_program_refuses_divergent_history(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    (remote / "tracked.txt").write_text("remote commit\n")
    _git(remote, "add", "tracked.txt")
    _git(remote, "commit", "-m", "divergent")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "not fast-forwardable" in result.stderr


def test_deploy_executable_remote_program_refuses_tracked_changes(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    (remote / "tracked.txt").write_text("dirty remote\n")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "tracked remote changes block deploy" in result.stderr


def test_rollback_executes_reachable_detached_checkout(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    sha = _git(remote, "rev-parse", "HEAD")
    env["SSH_RESULT"] = ""
    result = _run(repo, env, "rollback-home.sh", "--yes", sha)
    assert result.returncode == 0, result.stderr
    assert _git(remote, "rev-parse", "HEAD") == sha
    assert _git(remote, "branch", "--show-current") == ""


def test_rollback_rejects_commit_unreachable_from_origin_main(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    (remote / "tracked.txt").write_text("unpublished\n")
    _git(remote, "add", "tracked.txt")
    _git(remote, "commit", "-m", "unpublished")
    unreachable = _git(remote, "rev-parse", "HEAD")
    result = _run(repo, env, "rollback-home.sh", "--yes", unreachable)
    assert result.returncode != 0
    assert "not reachable from origin/main" in result.stderr


def test_remote_redeploy_failure_reports_both_shas(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    _remote_clone(repo, env)
    env["REMOTE_REDEPLOY_FAIL"] = "1"
    result = _run(repo, env, "deploy-home.sh")
    sha = _git(repo, "rev-parse", "HEAD")
    assert result.returncode != 0
    assert f"BLOGFORGE_DEPLOY_FAILURE\t{sha}\t{sha}" in result.stderr
    assert "launchctl print" in result.stderr


def test_help_does_not_require_git_or_ssh(deploy_repo) -> None:
    repo, env, ssh_log = deploy_repo
    for script in ("deploy-home.sh", "rollback-home.sh"):
        result = _run(repo, env, script, "--help")
        assert result.returncode == 0
        assert "Usage:" in result.stdout
    assert not ssh_log.exists()
