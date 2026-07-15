import os
import subprocess
from pathlib import Path

from click.testing import CliRunner

from blogforge import __version__
from blogforge.cli import main


def test_version_command() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["version"])
    assert result.exit_code == 0
    assert __version__ in result.output


def test_help_command() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["--help"])
    assert result.exit_code == 0
    assert "serve" in result.output


ROOT = Path(__file__).parents[3]


def _run_host_script(
    tmp_path: Path, script_name: str, *, with_codex: bool
) -> subprocess.CompletedProcess[str]:
    root = tmp_path / "project"
    scripts = root / "scripts"
    scripts.mkdir(parents=True)
    script = scripts / script_name
    script.write_text((ROOT / "scripts" / script_name).read_text())

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    if with_codex:
        codex = fake_bin / "codex"
        codex.write_text("#!/bin/sh\necho 'codex test version'\n")
        codex.chmod(0o755)

    if script_name == "serve-host.sh":
        docker = fake_bin / "docker"
        docker.write_text("#!/bin/sh\necho REACHED_HOST_STARTUP >&2\nexit 42\n")
        docker.chmod(0o755)
    else:
        (root / ".env.public").write_text("# test environment\n")
        app = root / ".venv" / "bin" / "blogforge"
        app.parent.mkdir(parents=True)
        app.write_text("#!/bin/sh\necho REACHED_PUBLIC_STARTUP\nexit 42\n")
        app.chmod(0o755)

    env = os.environ.copy()
    env["PATH"] = f"{fake_bin}:/usr/bin:/bin"
    return subprocess.run(
        ["/bin/bash", str(script)],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_serve_host_accepts_codex_only(tmp_path: Path) -> None:
    result = _run_host_script(tmp_path, "serve-host.sh", with_codex=True)
    assert result.returncode == 42
    assert "codex CLI" in result.stdout
    assert "REACHED_HOST_STARTUP" in result.stderr


def test_serve_public_accepts_codex_only(tmp_path: Path) -> None:
    result = _run_host_script(tmp_path, "serve-public.sh", with_codex=True)
    assert result.returncode == 42
    assert "codex CLI" in result.stdout
    assert "REACHED_PUBLIC_STARTUP" in result.stdout


def test_serve_host_rejects_when_no_local_cli_is_installed(tmp_path: Path) -> None:
    result = _run_host_script(tmp_path, "serve-host.sh", with_codex=False)
    assert result.returncode == 1
    assert "Install and authenticate Claude CLI or Codex CLI" in result.stderr


def test_serve_public_rejects_when_no_local_cli_is_installed(tmp_path: Path) -> None:
    result = _run_host_script(tmp_path, "serve-public.sh", with_codex=False)
    assert result.returncode == 1
    assert "Install and authenticate Claude CLI or Codex CLI" in result.stderr
