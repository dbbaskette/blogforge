"""Connector app boots, exposes health, and shares Pencraft's session auth."""
import pytest_asyncio
from fastapi import Depends
from fastapi.testclient import TestClient

from pencraft.auth.dependencies import get_current_user
from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.linkedin.app import create_linkedin_app
from pencraft.linkedin.config import get_linkedin_settings


def test_health_ok():
    app = create_linkedin_app()
    with TestClient(app) as c:
        r = c.get("/linkedin/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


def test_settings_defaults():
    get_linkedin_settings.cache_clear()
    s = get_linkedin_settings()
    assert s.authorize_url.endswith("/authorization")
    assert s.token_url.endswith("/accessToken")
    assert "userinfo" in s.userinfo_url
    assert s.api_version  # non-empty default version


@pytest_asyncio.fixture
async def signed_user_client():
    """A connector TestClient signed in as an approved user, plus a probe
    route that depends on the shared get_current_user."""
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        u = User(
            email="li@x.com", password_hash=hash_password("x"),
            status="approved", role="user",
        )
        session.add(u)
        await session.commit()
        await session.refresh(u)
        uid = u.id

    app = create_linkedin_app()

    @app.get("/linkedin/_probe")
    async def _probe(user: User = Depends(get_current_user)) -> dict[str, str]:
        return {"email": user.email}

    with TestClient(app) as c:
        c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
        yield c


async def test_shared_cookie_auth_accepts_valid_session(signed_user_client):
    r = signed_user_client.get("/linkedin/_probe")
    assert r.status_code == 200
    assert r.json()["email"] == "li@x.com"


async def test_shared_cookie_auth_rejects_missing_cookie():
    app = create_linkedin_app()

    @app.get("/linkedin/_probe2")
    async def _probe2(user: User = Depends(get_current_user)) -> dict[str, str]:
        return {"email": user.email}

    with TestClient(app) as c:
        assert c.get("/linkedin/_probe2").status_code == 401
