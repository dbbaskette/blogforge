"""No-Docker local default: a persistent SQLite file whose parent dir is created
automatically, so `blogforge serve` runs with zero database container."""

from __future__ import annotations

from pathlib import Path

import pytest

from blogforge.config.settings import Settings
from blogforge.db.engine import _ensure_sqlite_parent_dir


def test_ensure_sqlite_parent_dir_creates_missing_dir(tmp_path: Path) -> None:
    db = tmp_path / "nested" / "sub" / "blogforge.db"
    assert not db.parent.exists()
    _ensure_sqlite_parent_dir(f"sqlite+aiosqlite:///{db}")
    assert db.parent.is_dir()


def test_ensure_sqlite_parent_dir_is_noop_for_memory_and_postgres() -> None:
    # Neither should raise or create anything on disk.
    _ensure_sqlite_parent_dir("sqlite+aiosqlite:///:memory:")
    _ensure_sqlite_parent_dir("postgresql+asyncpg://u:p@host/db")


def test_local_default_database_url_is_a_persistent_sqlite_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The conftest autouse fixture pins :memory:; clear it to read the real default.
    monkeypatch.delenv("BLOGFORGE_DATABASE_URL", raising=False)
    assert Settings().database_url == "sqlite+aiosqlite:///.data/blogforge.db"
