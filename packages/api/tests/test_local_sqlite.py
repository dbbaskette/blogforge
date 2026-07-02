"""No-Docker local default: one standard folder (`data_dir`, default
`~/.blogforge`) holds the SQLite DB and blob files, so `blogforge serve` runs
with zero containers. On Tanzu these defaults are overridden by the bound
Postgres + Block Storage volume."""

from __future__ import annotations

import os
from pathlib import Path

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


def test_storage_dir_and_db_url_derive_from_data_dir() -> None:
    # Init args win over env, so this is hermetic vs. the conftest pins.
    s = Settings(data_dir="/tmp/bf-data", database_url="", storage_dir="")
    assert s.storage_dir == "/tmp/bf-data/blobs"
    assert s.database_url == "sqlite+aiosqlite:////tmp/bf-data/blogforge.db"


def test_default_data_dir_is_dot_blogforge_in_home() -> None:
    s = Settings(database_url="", storage_dir="")  # data_dir defaults to ~/.blogforge
    home = os.path.expanduser("~/.blogforge")
    assert s.storage_dir == os.path.join(home, "blobs")
    assert s.database_url == f"sqlite+aiosqlite:///{os.path.join(home, 'blogforge.db')}"


def test_explicit_sqlite_url_tilde_is_expanded() -> None:
    s = Settings(database_url="sqlite+aiosqlite:///~/foo/bar.db")
    assert "~" not in s.database_url
    assert s.database_url.endswith("/foo/bar.db")


def test_memory_url_is_preserved() -> None:
    # The test suite relies on this: conftest pins :memory:.
    s = Settings(database_url="sqlite+aiosqlite:///:memory:")
    assert s.database_url == "sqlite+aiosqlite:///:memory:"
