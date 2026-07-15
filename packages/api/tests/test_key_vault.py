"""KeyVault stores per-user provider keys, encrypted at rest."""
import pytest
import pytest_asyncio

from blogforge.auth.passwords import hash_password
from blogforge.db.base import Base
from blogforge.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from blogforge.db.models import User
from blogforge.keys.vault import SUPPORTED_PROVIDERS, KeyVault


@pytest.fixture(autouse=True)
def _isolate_from_real_myvoice_config(monkeypatch):
    """Point MYVOICE_CONFIG_PATH at a known-nonexistent file so the
    myvoice fallback yields '' unless a test deliberately writes one."""
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", "/nonexistent/myvoice.yaml")


@pytest_asyncio.fixture
async def setup():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        user = User(
            email="user@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


async def test_get_returns_empty_when_unset(setup):
    vault = KeyVault(setup)
    assert await vault.get("anthropic") == ""


async def test_set_then_get_round_trips(setup):
    vault = KeyVault(setup)
    await vault.set("anthropic", "sk-real-key")
    assert await vault.get("anthropic") == "sk-real-key"


async def test_set_overwrites_existing(setup):
    vault = KeyVault(setup)
    await vault.set("anthropic", "old-key")
    await vault.set("anthropic", "new-key")
    assert await vault.get("anthropic") == "new-key"


async def test_delete_removes_the_row(setup):
    vault = KeyVault(setup)
    await vault.set("anthropic", "sk-x")
    await vault.delete("anthropic")
    assert await vault.get("anthropic") == ""


async def test_delete_unknown_is_noop(setup):
    vault = KeyVault(setup)
    await vault.delete("anthropic")  # must not raise


async def test_list_status_shows_every_provider(setup):
    vault = KeyVault(setup)
    await vault.set("anthropic", "sk-a")

    status = await vault.list_status()
    assert set(status) == set(SUPPORTED_PROVIDERS)
    assert status["anthropic"] is True
    assert status["openai"] is False
    assert status["google"] is False


async def test_rejects_unknown_provider(setup):
    vault = KeyVault(setup)
    with pytest.raises(ValueError, match="unknown provider"):
        await vault.set("notreal", "x")
    with pytest.raises(ValueError, match="unknown provider"):
        await vault.get("notreal")


async def test_codex_cli_sentinel_tracks_binary(setup, monkeypatch):
    monkeypatch.setattr("blogforge.llm.codex_cli.codex_available", lambda: True)
    assert await KeyVault(setup).get("codex-cli") == "cli"

    monkeypatch.setattr("blogforge.llm.codex_cli.codex_available", lambda: False)
    assert await KeyVault(setup).get("codex-cli") == ""


async def test_keys_are_user_scoped(setup):
    """Keys set for one user must not be visible to another."""
    async with get_sessionmaker()() as session:
        other = User(
            email="other@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(other)
        await session.commit()
        await session.refresh(other)
        other_id = other.id

    vault_a = KeyVault(setup)
    vault_b = KeyVault(other_id)
    await vault_a.set("anthropic", "key-for-a")
    assert await vault_b.get("anthropic") == ""
