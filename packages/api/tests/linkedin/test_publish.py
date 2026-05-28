"""POST /publish, GET /posts, GET /stats/{id} — LinkedIn client stubbed."""
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.crypto import SecretCipher
from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import LinkedInConnection, User
from pencraft.linkedin.app import create_linkedin_app
from pencraft.linkedin.config import reset_linkedin_settings_for_tests


@pytest.fixture(autouse=True)
def _li_env(monkeypatch):
    monkeypatch.setenv("LINKEDIN_CLIENT_ID", "c")
    monkeypatch.setenv("LINKEDIN_CLIENT_SECRET", "s")
    reset_linkedin_settings_for_tests()
    yield
    reset_linkedin_settings_for_tests()


async def _connect_user(uid):
    """Insert a LinkedIn connection for the user with an encrypted token."""
    cipher = SecretCipher("test-session-secret")
    async with get_sessionmaker()() as session:
        session.add(
            LinkedInConnection(
                user_id=uid,
                member_urn="urn:li:person:me",
                member_name="Me",
                encrypted_access_token=cipher.encrypt("AQ-real"),
                scope="w_member_social",
                expires_at=datetime.now(UTC) + timedelta(days=30),
            )
        )
        await session.commit()


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
    with TestClient(app) as c:
        c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
        yield c, uid


async def test_publish_not_connected_401(client_uid):
    c, _ = client_uid
    r = c.post("/linkedin/publish", json={"text": "hello"})
    assert r.status_code == 401
    assert "not_connected" in r.text


async def test_publish_too_long_422(client_uid):
    c, uid = client_uid
    await _connect_user(uid)
    r = c.post("/linkedin/publish", json={"text": "x" * 3001})
    assert r.status_code == 422
    assert "content_too_long" in r.text


async def test_publish_happy_path(client_uid, monkeypatch):
    c, uid = client_uid
    await _connect_user(uid)

    async def _fake_create_post(self, *, author_urn, commentary, visibility="PUBLIC"):
        assert author_urn == "urn:li:person:me"
        assert commentary == "ship it"
        return "urn:li:share:555"

    monkeypatch.setattr(
        "pencraft.linkedin.client.LinkedInClient.create_post", _fake_create_post
    )

    r = c.post("/linkedin/publish", json={"text": "ship it"})
    assert r.status_code == 201
    assert r.json()["post_urn"] == "urn:li:share:555"

    # Listed in /posts
    posts = c.get("/linkedin/posts").json()
    assert len(posts) == 1
    assert posts[0]["post_urn"] == "urn:li:share:555"
    assert posts[0]["commentary"] == "ship it"


async def test_publish_stale_token_409(client_uid, monkeypatch):
    c, uid = client_uid
    await _connect_user(uid)

    from pencraft.linkedin.client import LinkedInError

    async def _stale(self, **kwargs):
        raise LinkedInError("expired", stale_token=True)

    monkeypatch.setattr(
        "pencraft.linkedin.client.LinkedInClient.create_post", _stale
    )
    r = c.post("/linkedin/publish", json={"text": "x"})
    assert r.status_code == 409
    assert "reconnect" in r.text


async def test_stats_fetches_and_caches(client_uid, monkeypatch):
    c, uid = client_uid
    await _connect_user(uid)

    async def _fake_create_post(self, **kwargs):
        return "urn:li:share:999"

    async def _fake_social(self, post_urn):
        return {"likes": 7, "comments": 2}

    monkeypatch.setattr(
        "pencraft.linkedin.client.LinkedInClient.create_post", _fake_create_post
    )
    monkeypatch.setattr(
        "pencraft.linkedin.client.LinkedInClient.social_actions", _fake_social
    )

    post_id = c.post("/linkedin/publish", json={"text": "go"}).json()
    # /posts gives us the internal id
    pid = c.get("/linkedin/posts").json()[0]["id"]

    r = c.get(f"/linkedin/stats/{pid}")
    assert r.status_code == 200
    body = r.json()
    assert body["likes"] == 7
    assert body["comments"] == 2
    assert body["fetched_at"]


async def test_stats_cross_user_404(client_uid, monkeypatch):
    c, uid = client_uid
    await _connect_user(uid)

    async def _fake_create_post(self, **kwargs):
        return "urn:li:share:abc"

    monkeypatch.setattr(
        "pencraft.linkedin.client.LinkedInClient.create_post", _fake_create_post
    )
    c.post("/linkedin/publish", json={"text": "mine"})
    pid = c.get("/linkedin/posts").json()[0]["id"]

    # Second user can't read the first user's post stats.
    async with get_sessionmaker()() as session:
        other = User(email="o@x.com", password_hash=hash_password("x"), status="approved", role="user")
        session.add(other)
        await session.commit()
        await session.refresh(other)
        other_id = other.id

    app = create_linkedin_app()
    with TestClient(app) as c2:
        c2.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(other_id))
        assert c2.get(f"/linkedin/stats/{pid}").status_code == 404
