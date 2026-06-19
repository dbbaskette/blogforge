"""KeyVault — per-user provider keys, encrypted at rest."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.auth.crypto import SecretCipher
from blogforge.config import get_settings
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import UserProviderKey

SUPPORTED_PROVIDERS: tuple[str, ...] = ("anthropic", "openai", "google")


def _cipher() -> SecretCipher:
    """Build a SecretCipher from the active session_secret.

    Resolved on every call so test fixtures that flip session_secret
    just work; the cipher is cheap to construct."""
    return SecretCipher(get_settings().session_secret)


class KeyVault:
    """Service object for per-user provider keys.

    Methods are async because they hit the DB.
    """

    def __init__(self, user_id: UUID) -> None:
        self._user_id = user_id

    async def get(self, provider: str) -> str:
        """Decrypted key for `provider`, or "" if not stored.
        Raises ValueError for unknown providers.

        `claude-cli` carries no key — it authenticates through the local
        Claude Code CLI — so we return a non-empty sentinel when the binary is
        present (and "" when it isn't). That lets the generation routes' key
        checks pass without special-casing each one, and makes availability
        track whether `claude` is actually installed."""
        if provider == "claude-cli":
            from blogforge.llm.claude_cli import claude_available

            return "cli" if claude_available() else ""
        self._check_provider(provider)
        async with get_sessionmaker()() as session:
            row = await self._load(session, provider)
            if row is not None:
                return _cipher().decrypt(row.encrypted_key)
        return ""

    async def set(self, provider: str, api_key: str) -> None:
        """Store an encrypted key, replacing any existing row."""
        self._check_provider(provider)
        if not api_key:
            raise ValueError("api_key must be non-empty")
        ciphertext = _cipher().encrypt(api_key)
        async with get_sessionmaker()() as session:
            existing = await self._load(session, provider)
            if existing is None:
                session.add(
                    UserProviderKey(
                        user_id=self._user_id,
                        provider=provider,
                        encrypted_key=ciphertext,
                    )
                )
            else:
                existing.encrypted_key = ciphertext
            await session.commit()

    async def delete(self, provider: str) -> None:
        """Drop the stored key. No-op if nothing's there."""
        self._check_provider(provider)
        async with get_sessionmaker()() as session:
            await session.execute(
                delete(UserProviderKey).where(
                    UserProviderKey.user_id == self._user_id,
                    UserProviderKey.provider == provider,
                )
            )
            await session.commit()

    async def list_status(self) -> dict[str, bool]:
        """Return {provider: bool} for each supported provider."""
        return {p: bool(await self.get(p)) for p in SUPPORTED_PROVIDERS}

    @staticmethod
    def _check_provider(provider: str) -> None:
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                f"unknown provider {provider!r}; expected one of {SUPPORTED_PROVIDERS}"
            )

    async def _load(self, session: AsyncSession, provider: str) -> UserProviderKey | None:
        result = await session.execute(
            select(UserProviderKey).where(
                UserProviderKey.user_id == self._user_id,
                UserProviderKey.provider == provider,
            )
        )
        return result.scalar_one_or_none()
