"""Non-admin users cannot reach /api/admin/*."""
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest_asyncio.fixture
async def app_with_users():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        user = User(
            email="u@x.com", password_hash=hash_password("x"),
            status="approved", role="user",
        )
        admin = User(
            email="a@x.com", password_hash=hash_password("x"),
            status="approved", role="admin",
        )
        session.add_all([user, admin])
        await session.commit()
        await session.refresh(user)
        await session.refresh(admin)
        return {"user_id": user.id, "admin_id": admin.id}


def _client_as(user_id):
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(user_id))
    return c


async def test_user_cannot_list_users(app_with_users):
    c = _client_as(app_with_users["user_id"])
    with c:
        r = c.get("/api/admin/users")
        assert r.status_code == 403


async def test_admin_can_list_users(app_with_users):
    c = _client_as(app_with_users["admin_id"])
    with c:
        r = c.get("/api/admin/users")
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert "u@x.com" in emails
        assert "a@x.com" in emails
