"""Admin /api/admin/keys: list / put / delete provider keys."""
import asyncio

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest.fixture(autouse=True)
def _isolate_myvoice(monkeypatch):
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", "/nonexistent.yaml")


@pytest_asyncio.fixture
async def setup():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        admin = User(
            email="root@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="admin",
        )
        user = User(
            email="u@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add_all([admin, user])
        await session.commit()
        await session.refresh(admin)
        await session.refresh(user)
        return {"admin": admin.id, "user": user.id}


def _client_as(user_id):
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(user_id))
    return c


async def test_non_admin_forbidden(setup):
    c = _client_as(setup["user"])
    with c:
        assert c.get("/api/admin/keys").status_code == 403


async def test_admin_list_initially_all_not_set(setup):
    c = _client_as(setup["admin"])
    with c:
        r = c.get("/api/admin/keys")
        assert r.status_code == 200
        rows = r.json()
        assert {row["provider"] for row in rows} == {"anthropic", "openai", "google"}
        assert all(row["configured"] is False for row in rows)
        assert all(row["source"] == "none" for row in rows)


async def test_put_rejects_bad_provider(setup):
    c = _client_as(setup["admin"])
    with c:
        r = c.put("/api/admin/keys/notreal", json={"api_key": "x"})
        assert r.status_code == 404


async def test_put_rejects_empty_key(setup):
    c = _client_as(setup["admin"])
    with c:
        r = c.put("/api/admin/keys/anthropic", json={"api_key": ""})
        assert r.status_code == 422


async def test_put_then_list_shows_configured_stored(setup, monkeypatch):
    """A successful PUT validates via list_models then persists."""
    # Stub the provider so we don't talk to Anthropic.
    monkeypatch.setattr(
        "pencraft.api.admin_keys._validate_with_provider",
        lambda provider, api_key: asyncio.sleep(0),
    )
    c = _client_as(setup["admin"])
    with c:
        r = c.put("/api/admin/keys/anthropic", json={"api_key": "sk-real"})
        assert r.status_code == 200
        body = r.json()
        assert body["provider"] == "anthropic"
        assert body["configured"] is True
        assert body["source"] == "stored"

        # List should now show stored for anthropic.
        rows = c.get("/api/admin/keys").json()
        ant = next(r for r in rows if r["provider"] == "anthropic")
        assert ant["configured"] is True
        assert ant["source"] == "stored"
        assert ant["updated_by"] == str(setup["admin"])


async def test_put_invalid_key_returns_400_and_does_not_persist(setup, monkeypatch):
    """If the provider rejects the key (list_models raises), we return 400
    and don't write the row."""
    def boom(provider, api_key):
        raise RuntimeError("invalid_api_key")

    monkeypatch.setattr("pencraft.api.admin_keys._validate_with_provider", boom)
    c = _client_as(setup["admin"])
    with c:
        r = c.put("/api/admin/keys/anthropic", json={"api_key": "sk-bad"})
        assert r.status_code == 400
        assert "invalid_api_key" in r.text

        rows = c.get("/api/admin/keys").json()
        ant = next(r for r in rows if r["provider"] == "anthropic")
        assert ant["configured"] is False


async def test_delete_removes_stored(setup, monkeypatch):
    monkeypatch.setattr(
        "pencraft.api.admin_keys._validate_with_provider",
        lambda p, k: None,
    )
    c = _client_as(setup["admin"])
    with c:
        c.put("/api/admin/keys/anthropic", json={"api_key": "sk-x"})
        r = c.delete("/api/admin/keys/anthropic")
        assert r.status_code == 204
        rows = c.get("/api/admin/keys").json()
        ant = next(r for r in rows if r["provider"] == "anthropic")
        assert ant["configured"] is False


async def test_delete_unknown_provider_404(setup):
    c = _client_as(setup["admin"])
    with c:
        r = c.delete("/api/admin/keys/notreal")
        assert r.status_code == 404
