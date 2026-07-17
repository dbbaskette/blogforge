from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[3]


def _git(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def _version(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/bash", "scripts/version.sh", *args],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize(
    ("baseline", "candidate"),
    [("0.7.0", "0.7.1"), ("0.7.9", "0.8.0"), ("0.99.99", "1.0.0")],
)
def test_compare_accepts_strict_increase(baseline: str, candidate: str) -> None:
    result = _version("compare", baseline, candidate)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("baseline", "candidate"),
    [
        ("0.7.0", "0.7.0"),
        ("0.7.1", "0.7.0"),
        ("0.7", "0.7.1"),
        ("0.7.0", "next"),
    ],
)
def test_compare_rejects_nonincrease_or_malformed(
    baseline: str, candidate: str
) -> None:
    result = _version("compare", baseline, candidate)
    assert result.returncode != 0


def _set_versions(repo: Path, version: str, *, api_version: str | None = None) -> None:
    web = repo / "packages/web/package.json"
    api = repo / "packages/api/blogforge/__init__.py"
    web.parent.mkdir(parents=True, exist_ok=True)
    api.parent.mkdir(parents=True, exist_ok=True)
    web.write_text(json.dumps({"version": version}, indent=2) + "\n")
    api.write_text(f'__version__ = "{api_version or version}"\n')


@pytest.fixture
def version_repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    subprocess.run(
        ["git", "init", "-b", "main", str(repo)], check=True, capture_output=True
    )
    _git(repo, "config", "user.email", "version-test@example.com")
    _git(repo, "config", "user.name", "Version Test")
    scripts = repo / "scripts"
    scripts.mkdir()
    for name in ("version.sh", "check-version-bump.sh"):
        source = ROOT / "scripts" / name
        if source.exists():
            target = scripts / name
            shutil.copy2(source, target)
            target.chmod(0o755)
    _set_versions(repo, "0.7.0")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    return repo, _git(repo, "rev-parse", "HEAD")


def _commit_file(
    repo: Path, path: str, content: str, *, add_all: bool = False
) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    _git(repo, "add", "." if add_all else path)
    _git(repo, "commit", "-m", f"change {path}")


def _check(repo: Path, base: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/bash", "scripts/check-version-bump.sh", base],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )


def test_runtime_change_requires_newer_version(version_repo) -> None:
    repo, base = version_repo
    _commit_file(repo, "packages/api/blogforge/server.py", "changed\n")
    result = _check(repo, base)
    assert result.returncode != 0
    assert "must be greater" in result.stderr


@pytest.mark.parametrize(
    "path",
    [
        "docs/note.md",
        "README.md",
        "CHANGELOG.md",
        "e2e/draft.spec.ts",
        "packages/api/tests/test_only.py",
        "packages/web/src/view.test.tsx",
        ".github/workflows/test.yml",
        ".claude/note.md",
        ".superpowers/note.md",
        "design-previews/example.html",
        "checkup.png",
        "playwright.config.ts",
    ],
)
def test_exempt_only_change_does_not_require_bump(
    version_repo, path: str
) -> None:
    repo, base = version_repo
    _commit_file(repo, path, "changed\n")
    result = _check(repo, base)
    assert result.returncode == 0, result.stderr


def test_unknown_path_defaults_to_requiring_bump(version_repo) -> None:
    repo, base = version_repo
    _commit_file(repo, "future-runtime/config.toml", "changed\n")
    result = _check(repo, base)
    assert result.returncode != 0
    assert "must be greater" in result.stderr


def test_runtime_change_with_patch_bump_passes(version_repo) -> None:
    repo, base = version_repo
    _set_versions(repo, "0.7.1")
    _commit_file(
        repo, "packages/api/blogforge/server.py", "changed\n", add_all=True
    )
    result = _check(repo, base)
    assert result.returncode == 0, result.stderr


def test_mixed_exempt_and_runtime_change_requires_bump(version_repo) -> None:
    repo, base = version_repo
    (repo / "docs/note.md").parent.mkdir(parents=True)
    (repo / "docs/note.md").write_text("docs\n")
    _commit_file(
        repo, "packages/api/blogforge/server.py", "runtime\n", add_all=True
    )
    result = _check(repo, base)
    assert result.returncode != 0
    assert "must be greater" in result.stderr


def test_mismatched_candidate_versions_fail(version_repo) -> None:
    repo, base = version_repo
    _set_versions(repo, "0.7.1", api_version="0.7.0")
    _commit_file(
        repo, "packages/api/blogforge/server.py", "changed\n", add_all=True
    )
    result = _check(repo, base)
    assert result.returncode != 0
    assert "version mismatch" in result.stderr
