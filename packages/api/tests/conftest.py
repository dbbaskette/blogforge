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
    are reset between tests so the new URL takes effect.

    Also creates the schema up front (since migrations-on-boot is disabled in
    tests) so the lifespan's admin-seed step can succeed."""
    import asyncio

    monkeypatch.setenv("PENCRAFT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("PENCRAFT_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("PENCRAFT_RUN_MIGRATIONS_ON_BOOT", "false")
    get_settings.cache_clear()
    reset_engine_for_tests()

    async def _setup_schema() -> None:
        from pencraft.db.engine import get_engine

        async with get_engine().begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup_schema())

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
    auth/SQL migration. Schema is created by the autouse
    `_force_sqlite_for_tests` fixture, which is required for the
    lifespan's admin-seed step to succeed."""
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


from pencraft.auth.passwords import hash_password  # noqa: E402
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner  # noqa: E402
from pencraft.db.engine import get_engine, get_sessionmaker  # noqa: E402
from pencraft.db.models import User  # noqa: E402


async def _seed_approved_user(email: str = "test@user.com"):
    """Insert an approved user; return its id.

    The schema is created by the autouse `_force_sqlite_for_tests` fixture."""
    async with get_sessionmaker()() as session:
        user = User(
            email=email,
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


def _signed_client(uid):
    """Build a TestClient and pre-set a signed session cookie for `uid`."""
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
    return c


@pytest_asyncio.fixture
async def authed_client():
    """A TestClient signed in as an approved user. Yields (client, user_id)."""
    uid = await _seed_approved_user()
    c = _signed_client(uid)
    with c:
        yield c, uid
