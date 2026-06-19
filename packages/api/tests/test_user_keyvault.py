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
