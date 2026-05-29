"""KeyVault stores admin-managed provider keys, falls back to myvoice config."""
import pytest
import pytest_asyncio
import yaml

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
        admin = User(
            email="root@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="admin",
        )
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        return admin.id


async def test_get_returns_empty_when_unset(setup):
    vault = KeyVault()
    assert await vault.get("anthropic") == ""


async def test_set_then_get_round_trips(setup):
    admin_id = setup
    vault = KeyVault()
    await vault.set("anthropic", "sk-real-key", updated_by=admin_id)
    assert await vault.get("anthropic") == "sk-real-key"


async def test_set_overwrites_existing(setup):
    admin_id = setup
    vault = KeyVault()
    await vault.set("anthropic", "old-key", updated_by=admin_id)
    await vault.set("anthropic", "new-key", updated_by=admin_id)
    assert await vault.get("anthropic") == "new-key"


async def test_delete_removes_the_row(setup):
    admin_id = setup
    vault = KeyVault()
    await vault.set("anthropic", "sk-x", updated_by=admin_id)
    await vault.delete("anthropic")
    assert await vault.get("anthropic") == ""


async def test_delete_unknown_is_noop(setup):
    vault = KeyVault()
    await vault.delete("anthropic")  # must not raise


async def test_falls_back_to_myvoice_config_when_unset(setup, tmp_path, monkeypatch):
    """Backward-compat: existing single-user installs read ~/.myvoice/config.yaml."""
    cfg = tmp_path / "myvoice.yaml"
    cfg.write_text(
        yaml.safe_dump(
            {"providers": {"anthropic": {"api_key": "fallback-key-from-myvoice"}}}
        )
    )
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(cfg))
    vault = KeyVault()
    assert await vault.get("anthropic") == "fallback-key-from-myvoice"


async def test_stored_key_wins_over_myvoice_fallback(setup, tmp_path, monkeypatch):
    """If a key is in the DB, the myvoice config never gets consulted."""
    admin_id = setup
    cfg = tmp_path / "myvoice.yaml"
    cfg.write_text(
        yaml.safe_dump(
            {"providers": {"anthropic": {"api_key": "fallback-key"}}}
        )
    )
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(cfg))
    vault = KeyVault()
    await vault.set("anthropic", "stored-key", updated_by=admin_id)
    assert await vault.get("anthropic") == "stored-key"


async def test_list_status_shows_every_provider(setup):
    admin_id = setup
    vault = KeyVault()
    await vault.set("anthropic", "sk-a", updated_by=admin_id)

    status = await vault.list_status()
    by_provider = {row["provider"]: row for row in status}
    assert set(by_provider) == set(SUPPORTED_PROVIDERS)
    assert by_provider["anthropic"]["configured"] is True
    assert by_provider["openai"]["configured"] is False
    assert by_provider["google"]["configured"] is False


async def test_rejects_unknown_provider(setup):
    vault = KeyVault()
    with pytest.raises(ValueError, match="unknown provider"):
        await vault.set("notreal", "x", updated_by=setup)
    with pytest.raises(ValueError, match="unknown provider"):
        await vault.get("notreal")
