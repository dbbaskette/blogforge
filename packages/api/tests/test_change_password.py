"""session-revoke-all invalidates old session cookies; /me returns identity."""
import pytest_asyncio
from fastapi.testclient import TestClient

from blogforge.auth.passwords import hash_password
from blogforge.auth.sessions import COOKIE_NAME, SessionSigner
from blogforge.db.base import Base
from blogforge.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from blogforge.db.models import User
from blogforge.server import create_app


@pytest_asyncio.fixture
async def client_uid():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        u = User(
            email="acct@x.com",
            password_hash=hash_password("oldpassword"),
            status="approved",
            role="user",
        )
        session.add(u)
        await session.commit()
        await session.refresh(u)
        uid = u.id
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid, 0))
    with c:
        yield c, uid


async def test_old_cookie_invalid_after_revoke_all(client_uid):
    c, uid = client_uid
    # Confirm the session works first.
    assert c.get("/api/auth/me").status_code == 200
    # Revoke all sessions → version bumps to 1; this cookie was v0.
    assert c.post("/api/auth/sessions/revoke-all").status_code == 204
    # A fresh client carrying the OLD v0 cookie is now rejected.
    app2 = create_app()
    c2 = TestClient(app2)
    c2.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid, 0))
    with c2:
        r = c2.get("/api/auth/me")
        assert r.status_code == 401
        assert "session_revoked" in r.text


async def test_me_includes_last_login(client_uid):
    c, _ = client_uid
    # last_login_at is None until a real login; the field is present regardless.
    body = c.get("/api/auth/me").json()
    assert "last_login_at" in body
