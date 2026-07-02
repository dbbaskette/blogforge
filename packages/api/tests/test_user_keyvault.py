import uuid

import pytest

from blogforge.keys import KeyVault


async def test_set_get_roundtrip_is_user_scoped() -> None:
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    await KeyVault(u1).set("anthropic", "sk-ant-u1")
    assert await KeyVault(u1).get("anthropic") == "sk-ant-u1"
    assert await KeyVault(u2).get("anthropic") == ""

async def test_delete_and_status() -> None:
    u = uuid.uuid4()
    await KeyVault(u).set("openai", "sk-u")
    assert (await KeyVault(u).list_status())["openai"] is True
    await KeyVault(u).delete("openai")
    assert (await KeyVault(u).list_status())["openai"] is False

async def test_unknown_provider_raises() -> None:
    with pytest.raises(ValueError):
        await KeyVault(uuid.uuid4()).get("bogus")


async def test_key_encrypted_under_different_secret_reads_as_unset() -> None:
    """A stored key encrypted under a since-changed session_secret must degrade
    to "" (and list_status False), not raise InvalidToken and 500 the keys page."""
    from sqlalchemy import select

    from blogforge.auth.crypto import SecretCipher
    from blogforge.db.engine import get_sessionmaker
    from blogforge.db.models import UserProviderKey

    u = uuid.uuid4()
    foreign = SecretCipher("a-different-old-session-secret").encrypt("sk-google-old")
    async with get_sessionmaker()() as s:
        s.add(UserProviderKey(user_id=u, provider="google", encrypted_key=foreign))
        await s.commit()

    # get() degrades gracefully instead of raising…
    assert await KeyVault(u).get("google") == ""
    # …and list_status() (what GET /api/keys calls) doesn't blow up.
    assert (await KeyVault(u).list_status())["google"] is False
    # The undecryptable row is left in place (user can overwrite by re-entering).
    async with get_sessionmaker()() as s:
        result = await s.execute(select(UserProviderKey).where(UserProviderKey.user_id == u))
        rows = result.scalars().all()
    assert len(rows) == 1
