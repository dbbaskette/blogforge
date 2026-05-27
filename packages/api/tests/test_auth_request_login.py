"""POST /api/auth/request creates a pending user."""
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


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
        user = (await session.execute(select(User))).scalar_one()
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
