"""POST /api/auth/request creates a pending user."""
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

from blogforge.db.base import Base
from blogforge.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from blogforge.db.models import User
from blogforge.server import create_app


@pytest_asyncio.fixture
async def client():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app = create_app()
    with TestClient(app) as c:
        yield c


async def test_request_creates_pending_user(client):
    r = client.post(
        "/api/auth/request",
        json={"email": "new@user.com", "password": "secret123"},
    )
    assert r.status_code == 201

    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "new@user.com"))
        ).scalar_one()
        assert user.status == "pending"
        assert user.role == "user"


async def test_request_lowercases_email(client):
    r = client.post(
        "/api/auth/request",
        json={"email": "MIXED@Case.COM", "password": "secret123"},
    )
    assert r.status_code == 201
    async with get_sessionmaker()() as session:
        # The lifespan also seeds the admin user (Task 21), so filter for the
        # request we just made instead of asserting a single row.
        user = (
            await session.execute(select(User).where(User.email == "mixed@case.com"))
        ).scalar_one()
        assert user.email == "mixed@case.com"


async def test_request_duplicate_email_returns_409(client):
    r1 = client.post(
        "/api/auth/request",
        json={"email": "dup@user.com", "password": "secret123"},
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/api/auth/request",
        json={"email": "DUP@user.com", "password": "different"},
    )
    assert r2.status_code == 409


async def test_request_rejects_short_password(client):
    r = client.post(
        "/api/auth/request",
        json={"email": "x@y.com", "password": "short"},
    )
    assert r.status_code == 422


async def test_login_approved_user_sets_cookie(client):
    client.post(
        "/api/auth/request",
        json={"email": "go@user.com", "password": "secret123"},
    )
    # Approve manually for this test.
    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "go@user.com"))
        ).scalar_one()
        user.status = "approved"
        await session.commit()

    r = client.post(
        "/api/auth/login",
        json={"email": "go@user.com", "password": "secret123"},
    )
    assert r.status_code == 200
    assert "blogforge_session" in r.cookies
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "go@user.com"


async def test_login_pending_blocked(client):
    client.post(
        "/api/auth/request",
        json={"email": "p@user.com", "password": "secret123"},
    )
    r = client.post(
        "/api/auth/login",
        json={"email": "p@user.com", "password": "secret123"},
    )
    assert r.status_code == 403


async def test_login_wrong_password_returns_401(client):
    client.post(
        "/api/auth/request",
        json={"email": "w@user.com", "password": "secret123"},
    )
    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "w@user.com"))
        ).scalar_one()
        user.status = "approved"
        await session.commit()
    r = client.post(
        "/api/auth/login",
        json={"email": "w@user.com", "password": "wrong"},
    )
    assert r.status_code == 401


async def test_login_unknown_email_returns_401(client):
    r = client.post(
        "/api/auth/login",
        json={"email": "ghost@nowhere.com", "password": "anything"},
    )
    assert r.status_code == 401


async def test_logout_clears_cookie(client):
    client.post(
        "/api/auth/request",
        json={"email": "lo@user.com", "password": "secret123"},
    )
    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "lo@user.com"))
        ).scalar_one()
        user.status = "approved"
        await session.commit()
    client.post(
        "/api/auth/login",
        json={"email": "lo@user.com", "password": "secret123"},
    )
    r = client.post("/api/auth/logout")
    assert r.status_code == 204
    me = client.get("/api/auth/me")
    assert me.status_code == 401
