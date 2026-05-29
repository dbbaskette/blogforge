"""change-password + sign-out-everywhere invalidate old session cookies."""
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password, verify_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


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


async def test_change_password_rejects_wrong_old(client_uid):
    c, _ = client_uid
    r = c.post(
        "/api/auth/change-password",
        json={"old_password": "wrong", "new_password": "brandnew123"},
    )
    assert r.status_code == 400
    assert "invalid_old_password" in r.text


async def test_change_password_updates_hash_and_bumps_version(client_uid):
    c, uid = client_uid
    r = c.post(
        "/api/auth/change-password",
        json={"old_password": "oldpassword", "new_password": "brandnew123"},
    )
    assert r.status_code == 200
    async with get_sessionmaker()() as session:
        from sqlalchemy import select

        u = (await session.execute(select(User).where(User.id == uid))).scalar_one()
        assert verify_password("brandnew123", u.password_hash)
        assert u.session_version == 1
    # The response re-issued a v1 cookie, so /me still works for this session.
    assert c.get("/api/auth/me").status_code == 200


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
    # last_login_at is None until a real /login; the field is present regardless.
    body = c.get("/api/auth/me").json()
    assert "last_login_at" in body
