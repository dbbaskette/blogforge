"""Encrypted, per-user GitHub publishing credentials."""

from __future__ import annotations

import logging
from uuid import UUID

from cryptography.fernet import InvalidToken
from sqlalchemy import delete, select

from blogforge.auth.crypto import SecretCipher
from blogforge.config import get_settings
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import UserProviderKey

logger = logging.getLogger(__name__)

PUBLISHING_PROVIDER = "github-publishing"


class PublishingTokenVault:
    def __init__(self, user_id: UUID) -> None:
        self._user_id = user_id

    async def get(self) -> str:
        async with get_sessionmaker()() as session:
            row = await session.scalar(
                select(UserProviderKey).where(
                    UserProviderKey.user_id == self._user_id,
                    UserProviderKey.provider == PUBLISHING_PROVIDER,
                )
            )
        if row is None:
            return ""
        try:
            return SecretCipher(get_settings().session_secret).decrypt(row.encrypted_key)
        except InvalidToken:
            logger.warning(
                "GitHub publishing token for user %s cannot be decrypted; treating as unset",
                self._user_id,
            )
            return ""

    async def is_set(self) -> bool:
        return bool(await self.get())

    async def set(self, token: str) -> None:
        cleaned = token.strip()
        if not cleaned:
            raise ValueError("token must not be empty")
        encrypted = SecretCipher(get_settings().session_secret).encrypt(cleaned)
        async with get_sessionmaker()() as session:
            row = await session.scalar(
                select(UserProviderKey).where(
                    UserProviderKey.user_id == self._user_id,
                    UserProviderKey.provider == PUBLISHING_PROVIDER,
                )
            )
            if row is None:
                session.add(
                    UserProviderKey(
                        user_id=self._user_id,
                        provider=PUBLISHING_PROVIDER,
                        encrypted_key=encrypted,
                    )
                )
            else:
                row.encrypted_key = encrypted
            await session.commit()

    async def delete(self) -> None:
        async with get_sessionmaker()() as session:
            await session.execute(
                delete(UserProviderKey).where(
                    UserProviderKey.user_id == self._user_id,
                    UserProviderKey.provider == PUBLISHING_PROVIDER,
                )
            )
            await session.commit()
