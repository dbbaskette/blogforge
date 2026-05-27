"""Shared pytest fixtures — async DB + legacy sync TestClient.

The TestClient `client` fixture is the legacy entry point still used by
test_server.py and the existing API route tests. Task 18 will sweep those
to authenticated SQL-backed clients; until then we leave it in place.
"""
from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from pencraft.config import get_settings
from pencraft.db import reset_engine_for_tests
from pencraft.db.base import Base
from pencraft.server import create_app


@pytest.fixture(autouse=True)
def _force_sqlite_for_tests(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Every test runs against a fresh in-memory sqlite. Module-level singletons
    are reset between tests so the new URL takes effect."""
    monkeypatch.setenv("PENCRAFT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("PENCRAFT_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("PENCRAFT_RUN_MIGRATIONS_ON_BOOT", "false")
    get_settings.cache_clear()
    reset_engine_for_tests()
    yield
    get_settings.cache_clear()
    reset_engine_for_tests()


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    """A session bound to a fresh in-memory sqlite DB with schema created."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s
    await engine.dispose()


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Legacy sync FastAPI TestClient. Kept for tests that pre-date the
    auth/SQL migration; will be replaced by an authenticated async client
    in Task 18 of Phase A."""
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
