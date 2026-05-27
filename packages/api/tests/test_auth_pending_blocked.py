"""A pending user cannot reach authenticated endpoints."""
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest_asyncio.fixture
async def client_for_pending_user():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        u = User(
            email="pend@user.com",
            password_hash=hash_password("x"),
            status="pending",
            role="user",
        )
        session.add(u)
        await session.commit()
        await session.refresh(u)
        uid = u.id

    app = create_app()
    with TestClient(app) as c:
        signer = SessionSigner("test-session-secret")
        c.cookies.set(COOKIE_NAME, signer.sign(uid))
        yield c


async def test_pending_user_blocked_from_drafts(client_for_pending_user):
    r = client_for_pending_user.get("/api/drafts")
    assert r.status_code == 403


async def test_pending_user_blocked_from_me(client_for_pending_user):
    """Pending users hit /api/auth/me and get 403 with status_pending in the
    body, so the FE can route them to the 'waiting for approval' screen."""
    r = client_for_pending_user.get("/api/auth/me")
    assert r.status_code == 403
    assert "status_pending" in r.text
