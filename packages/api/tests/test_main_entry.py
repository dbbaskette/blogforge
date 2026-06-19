import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def test_blogforge_module_is_runnable() -> None:
    """`python -m blogforge --help` works with PYTHONPATH=packages/api (how CF runs it)."""
    r = subprocess.run(
        [sys.executable, "-m", "blogforge", "--help"],
        cwd=REPO,
        env={"PYTHONPATH": "packages/api", "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert "serve" in r.stdout


def test_alembic_dir_resolves_from_source() -> None:
    """Running from source keeps alembic/ at parents[1] of server.py (no install needed)."""
    server = REPO / "packages/api/blogforge/server.py"
    alembic = server.resolve().parents[1] / "alembic"
    assert alembic.is_dir()
