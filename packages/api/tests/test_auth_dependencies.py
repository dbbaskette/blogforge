"""get_current_user reads the session cookie, returns 401 / 403 as appropriate."""
import pytest_asyncio
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from pencraft.auth.dependencies import get_current_user, require_admin
from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User


def _make_app():
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(u: User = Depends(get_current_user)):
        return {"email": u.email, "role": u.role}

    @app.get("/admin-only")
    async def admin_only(u: User = Depends(require_admin)):
        return {"ok": True}

    return app


@pytest_asyncio.fixture
async def setup_db_and_user():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = get_sessionmaker()
    async with sm() as s:
        approved = User(
            email="a@b.com", password_hash=hash_password("x"),
            status="approved", role="user",
        )
        pending = User(
            email="p@b.com", password_hash=hash_password("x"),
            status="pending", role="user",
        )
        admin = User(
            email="r@b.com", password_hash=hash_password("x"),
            status="approved", role="admin",
        )
        s.add_all([approved, pending, admin])
        await s.commit()
        await s.refresh(approved)
        await s.refresh(pending)
        await s.refresh(admin)
    return {"approved": approved.id, "pending": pending.id, "admin": admin.id}


def _client_with_cookie(user_id):
    app = _make_app()
    client = TestClient(app)
    signer = SessionSigner("test-session-secret")
    client.cookies.set(COOKIE_NAME, signer.sign(user_id))
    return client


async def test_no_cookie_returns_401(setup_db_and_user):
    app = _make_app()
    with TestClient(app) as client:
        r = client.get("/whoami")
        assert r.status_code == 401


async def test_garbage_cookie_returns_401(setup_db_and_user):
    app = _make_app()
    with TestClient(app) as client:
        client.cookies.set(COOKIE_NAME, "garbage")
        r = client.get("/whoami")
        assert r.status_code == 401


async def test_approved_user_returns_user(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["approved"])
    with client:
        r = client.get("/whoami")
        assert r.status_code == 200
        assert r.json() == {"email": "a@b.com", "role": "user"}


async def test_pending_user_returns_403(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["pending"])
    with client:
        r = client.get("/whoami")
        assert r.status_code == 403


async def test_require_admin_blocks_user(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["approved"])
    with client:
        r = client.get("/admin-only")
        assert r.status_code == 403


async def test_require_admin_allows_admin(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["admin"])
    with client:
        r = client.get("/admin-only")
        assert r.status_code == 200
