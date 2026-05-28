"""OAuth routes: connect → callback → status → disconnect, LinkedIn mocked."""
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import pytest_asyncio
import respx
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import LinkedInConnection, User
from pencraft.linkedin.app import create_linkedin_app
from pencraft.linkedin.config import get_linkedin_settings, reset_linkedin_settings_for_tests
from pencraft.linkedin.state import sign_state


@pytest.fixture(autouse=True)
def _li_env(monkeypatch):
    monkeypatch.setenv("LINKEDIN_CLIENT_ID", "test-client")
    monkeypatch.setenv("LINKEDIN_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("LINKEDIN_REDIRECT_URI", "http://localhost:7890/linkedin/callback")
    monkeypatch.setenv("LINKEDIN_POST_CONNECT_REDIRECT", "http://localhost:7880/settings")
    reset_linkedin_settings_for_tests()
    yield
    reset_linkedin_settings_for_tests()


@pytest_asyncio.fixture
async def client_uid():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        u = User(email="li@x.com", password_hash=hash_password("x"), status="approved", role="user")
        session.add(u)
        await session.commit()
        await session.refresh(u)
        uid = u.id
    app = create_linkedin_app()
    with TestClient(app, follow_redirects=False) as c:
        c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
        yield c, uid


async def test_connect_returns_authorize_url(client_uid):
    c, _uid = client_uid
    r = c.get("/linkedin/connect")
    assert r.status_code == 200
    url = r.json()["authorize_url"]
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    assert parsed.netloc == "www.linkedin.com"
    assert qs["response_type"] == ["code"]
    assert qs["client_id"] == ["test-client"]
    assert "w_member_social" in qs["scope"][0]
    assert "openid" in qs["scope"][0]
    assert qs["state"][0]  # present + signed


async def test_status_not_connected(client_uid):
    c, _ = client_uid
    r = c.get("/linkedin/status")
    assert r.status_code == 200
    assert r.json()["connected"] is False


@respx.mock
async def test_callback_exchanges_code_and_persists(client_uid):
    c, uid = client_uid
    s = get_linkedin_settings()

    respx.post(s.token_url).mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "AQ-real-token", "expires_in": 5184000, "scope": s.scopes},
        )
    )
    respx.get(s.userinfo_url).mock(
        return_value=httpx.Response(
            200, json={"sub": "member123", "name": "Dan Baskette"}
        )
    )

    state = sign_state(uid, secret="test-session-secret")
    r = c.get(f"/linkedin/callback?code=the-code&state={state}")
    assert r.status_code == 302
    assert r.headers["location"] == "http://localhost:7880/settings"

    # Connection persisted + token encrypted (not the raw value).
    async with get_sessionmaker()() as session:
        from sqlalchemy import select

        conn = (
            await session.execute(
                select(LinkedInConnection).where(LinkedInConnection.user_id == uid)
            )
        ).scalar_one()
        assert conn.member_urn == "urn:li:person:member123"
        assert conn.member_name == "Dan Baskette"
        assert conn.encrypted_access_token != "AQ-real-token"  # encrypted at rest

    # status now reports connected
    r2 = c.get("/linkedin/status")
    assert r2.json()["connected"] is True
    assert r2.json()["member_name"] == "Dan Baskette"


async def test_callback_bad_state_400(client_uid):
    c, _ = client_uid
    r = c.get("/linkedin/callback?code=x&state=garbage")
    assert r.status_code == 400


@respx.mock
async def test_callback_token_exchange_failure_502(client_uid):
    c, uid = client_uid
    s = get_linkedin_settings()
    respx.post(s.token_url).mock(return_value=httpx.Response(400, json={"error": "bad"}))
    state = sign_state(uid, secret="test-session-secret")
    r = c.get(f"/linkedin/callback?code=x&state={state}")
    assert r.status_code == 502
    # nothing persisted
    async with get_sessionmaker()() as session:
        from sqlalchemy import select

        rows = (await session.execute(select(LinkedInConnection))).scalars().all()
        assert rows == []


@respx.mock
async def test_disconnect_removes_connection(client_uid):
    c, uid = client_uid
    s = get_linkedin_settings()
    respx.post(s.token_url).mock(
        return_value=httpx.Response(
            200, json={"access_token": "t", "expires_in": 100, "scope": s.scopes}
        )
    )
    respx.get(s.userinfo_url).mock(
        return_value=httpx.Response(200, json={"sub": "m", "name": "N"})
    )
    state = sign_state(uid, secret="test-session-secret")
    c.get(f"/linkedin/callback?code=x&state={state}")
    assert c.get("/linkedin/status").json()["connected"] is True

    r = c.delete("/linkedin/connection")
    assert r.status_code == 204
    assert c.get("/linkedin/status").json()["connected"] is False
