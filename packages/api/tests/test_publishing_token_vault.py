from uuid import uuid4

from sqlalchemy import select

from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import UserProviderKey
from blogforge.publishing.token_vault import PUBLISHING_PROVIDER, PublishingTokenVault


async def test_token_is_encrypted_and_user_scoped() -> None:
    user_a, user_b = uuid4(), uuid4()
    await PublishingTokenVault(user_a).set("github_pat_secret")

    assert await PublishingTokenVault(user_a).get() == "github_pat_secret"
    assert await PublishingTokenVault(user_a).is_set() is True
    assert await PublishingTokenVault(user_b).get() == ""
    assert await PublishingTokenVault(user_b).is_set() is False

    async with get_sessionmaker()() as session:
        row = await session.scalar(
            select(UserProviderKey).where(
                UserProviderKey.user_id == user_a,
                UserProviderKey.provider == PUBLISHING_PROVIDER,
            )
        )
    assert row is not None
    assert "github_pat_secret" not in row.encrypted_key


async def test_token_can_be_replaced_and_cleared() -> None:
    user_id = uuid4()
    vault = PublishingTokenVault(user_id)
    await vault.set("first")
    await vault.set("second")
    assert await vault.get() == "second"

    await vault.delete()
    assert await vault.get() == ""
    assert await vault.is_set() is False


async def test_undecryptable_token_is_treated_as_unset() -> None:
    user_id = uuid4()
    vault = PublishingTokenVault(user_id)
    await vault.set("github_pat_secret")

    async with get_sessionmaker()() as session:
        row = await session.scalar(
            select(UserProviderKey).where(
                UserProviderKey.user_id == user_id,
                UserProviderKey.provider == PUBLISHING_PROVIDER,
            )
        )
        assert row is not None
        row.encrypted_key = "corrupt-ciphertext"
        await session.commit()

    assert await vault.get() == ""
    assert await vault.is_set() is False
