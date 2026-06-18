"""Approve / reject / disable / promote endpoints."""
from uuid import uuid4

import pytest_asyncio
from fastapi.testclient import TestClient

from blogforge.auth.passwords import hash_password
from blogforge.auth.sessions import COOKIE_NAME, SessionSigner
from blogforge.db.base import Base
from blogforge.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from blogforge.db.models import User
from blogforge.server import create_app


@pytest_asyncio.fixture
async def setup():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        admin = User(
            email="root@x.com", password_hash=hash_password("x"),
            status="approved", role="admin",
        )
        pending = User(
            email="p@x.com", password_hash=hash_password("x"),
            status="pending", role="user",
        )
        session.add_all([admin, pending])
        await session.commit()
        await session.refresh(admin)
        await session.refresh(pending)
        return {"admin": admin.id, "pending": pending.id}


def _admin_client(admin_id):
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(admin_id))
    return c


async def test_filter_by_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.get("/api/admin/users?status=pending")
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert emails == ["p@x.com"]


async def test_approve_flips_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.post(f"/api/admin/users/{setup['pending']}/approve")
        assert r.status_code == 200
        assert r.json()["status"] == "approved"


async def test_reject_flips_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.post(f"/api/admin/users/{setup['pending']}/reject")
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"


async def test_disable_flips_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        # approve first
        c.post(f"/api/admin/users/{setup['pending']}/approve")
        r = c.post(f"/api/admin/users/{setup['pending']}/disable")
        assert r.status_code == 200
        assert r.json()["status"] == "disabled"


async def test_promote_to_admin(setup):
    c = _admin_client(setup["admin"])
    with c:
        c.post(f"/api/admin/users/{setup['pending']}/approve")
        r = c.post(f"/api/admin/users/{setup['pending']}/promote")
        assert r.status_code == 200
        assert r.json()["role"] == "admin"


async def test_404_on_unknown_user(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.post(f"/api/admin/users/{uuid4()}/approve")
        assert r.status_code == 404


async def test_list_includes_github_user_with_null_email(setup):
    """A GitHub user with a private (null) email must serialize, not 500,
    and the admin list must carry github_login."""
    async with get_sessionmaker()() as session:
        session.add(
            User(
                email=None, github_id=4242, github_login="ghuser",
                status="approved", role="user",
            )
        )
        await session.commit()
    c = _admin_client(setup["admin"])
    with c:
        r = c.get("/api/admin/users")
        assert r.status_code == 200
        rows = {u["github_login"]: u for u in r.json() if u["github_login"]}
        assert "ghuser" in rows
        assert rows["ghuser"]["email"] is None
