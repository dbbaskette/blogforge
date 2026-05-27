"""KeyVault — admin-managed provider keys, encrypted at rest.

Falls back to ~/.myvoice/config.yaml when no admin-managed key is set
for a provider. That keeps existing single-user installs working
without forcing them through the admin UI.
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import TypedDict
from uuid import UUID

import yaml
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.crypto import SecretCipher
from pencraft.config import get_settings
from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import ProviderKey

SUPPORTED_PROVIDERS: tuple[str, ...] = ("anthropic", "openai", "google")


class ProviderKeyStatus(TypedDict):
    provider: str
    configured: bool
    source: str  # "stored" | "myvoice" | "none"
    updated_at: datetime | None
    updated_by: UUID | None


def _myvoice_config_path() -> Path:
    env = os.environ.get("MYVOICE_CONFIG_PATH")
    return Path(env) if env else Path.home() / ".myvoice" / "config.yaml"


def _read_myvoice_key(provider: str) -> str:
    """Best-effort read from ~/.myvoice/config.yaml. Empty string on any error."""
    path = _myvoice_config_path()
    if not path.is_file():
        return ""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (yaml.YAMLError, OSError):
        return ""
    providers = data.get("providers") or {}
    return str((providers.get(provider) or {}).get("api_key") or "")


def _cipher() -> SecretCipher:
    """Build a SecretCipher from the active session_secret.

    Resolved on every call so test fixtures that flip session_secret
    just work; the cipher is cheap to construct."""
    return SecretCipher(get_settings().session_secret)


class KeyVault:
    """Service object for admin-managed provider keys.

    Methods are async because they hit the DB; tests can stub by passing
    in a custom session via the optional `_session` arg (mostly for
    transaction reuse from the admin routes).
    """

    async def get(self, provider: str) -> str:
        """Decrypted key for `provider`, or "" if neither stored nor in
        the myvoice config. Raises ValueError for unknown providers."""
        self._check_provider(provider)
        async with get_sessionmaker()() as session:
            row = await self._load(session, provider)
            if row is not None:
                return _cipher().decrypt(row.encrypted_key)
        return _read_myvoice_key(provider)

    async def set(self, provider: str, api_key: str, *, updated_by: UUID) -> None:
        """Store an encrypted key, replacing any existing row."""
        self._check_provider(provider)
        if not api_key:
            raise ValueError("api_key must be non-empty")
        ciphertext = _cipher().encrypt(api_key)
        async with get_sessionmaker()() as session:
            existing = await self._load(session, provider)
            if existing is None:
                session.add(
                    ProviderKey(
                        provider=provider,
                        encrypted_key=ciphertext,
                        updated_by=updated_by,
                    )
                )
            else:
                existing.encrypted_key = ciphertext
                existing.updated_by = updated_by
            await session.commit()

    async def delete(self, provider: str) -> None:
        """Drop the stored key. No-op if nothing's there."""
        self._check_provider(provider)
        async with get_sessionmaker()() as session:
            await session.execute(
                delete(ProviderKey).where(ProviderKey.provider == provider)
            )
            await session.commit()

    async def list_status(self) -> list[ProviderKeyStatus]:
        """One status row per supported provider, ordered consistently.

        `source` records where the key came from for /admin/keys UI:
        - "stored" — admin-managed row exists.
        - "myvoice" — falling back to ~/.myvoice/config.yaml.
        - "none" — no key anywhere.
        Never returns the key itself.
        """
        async with get_sessionmaker()() as session:
            rows = (await session.execute(select(ProviderKey))).scalars().all()
        by_provider = {r.provider: r for r in rows}
        out: list[ProviderKeyStatus] = []
        for provider in SUPPORTED_PROVIDERS:
            stored = by_provider.get(provider)
            if stored is not None:
                out.append(
                    ProviderKeyStatus(
                        provider=provider,
                        configured=True,
                        source="stored",
                        updated_at=stored.updated_at,
                        updated_by=stored.updated_by,
                    )
                )
            elif _read_myvoice_key(provider):
                out.append(
                    ProviderKeyStatus(
                        provider=provider,
                        configured=True,
                        source="myvoice",
                        updated_at=None,
                        updated_by=None,
                    )
                )
            else:
                out.append(
                    ProviderKeyStatus(
                        provider=provider,
                        configured=False,
                        source="none",
                        updated_at=None,
                        updated_by=None,
                    )
                )
        return out

    @staticmethod
    def _check_provider(provider: str) -> None:
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                f"unknown provider {provider!r}; expected one of {SUPPORTED_PROVIDERS}"
            )

    @staticmethod
    async def _load(session: AsyncSession, provider: str) -> ProviderKey | None:
        result = await session.execute(
            select(ProviderKey).where(ProviderKey.provider == provider)
        )
        row: ProviderKey | None = result.scalar_one_or_none()
        return row
