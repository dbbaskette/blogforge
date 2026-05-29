"""Admin /api/admin/keys: list / put / delete provider API keys.

PUT validates by calling provider.list_models() before persisting so a
typo doesn't quietly land in the DB and break every draft.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import require_admin
from blogforge.db.models import User
from blogforge.keys import SUPPORTED_PROVIDERS, KeyVault
from blogforge.keys.vault import ProviderKeyStatus
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider

router = APIRouter(
    prefix="/api/admin/keys",
    tags=["admin", "keys"],
    dependencies=[Depends(require_admin)],
)


class KeyStatusOut(BaseModel):
    provider: str
    configured: bool
    source: str  # "stored" | "myvoice" | "none"
    updated_at: datetime | None
    updated_by: str | None


class SetKeyBody(BaseModel):
    api_key: str = Field(min_length=1, max_length=4096)


async def _validate_with_provider(provider: str, api_key: str) -> None:
    """Confirm `api_key` actually works against the provider's API.

    Module-level so tests can monkeypatch it with a no-op. Tests
    substitute with `lambda p, k: asyncio.sleep(0)` (any awaitable that
    resolves to None) or an async function.
    """
    client = get_provider(provider, api_key)
    await client.list_models()


def _check_provider(provider: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown_provider:{provider}",
        )


def _status_to_out(row: ProviderKeyStatus) -> KeyStatusOut:
    updated_by = row["updated_by"]
    return KeyStatusOut(
        provider=row["provider"],
        configured=row["configured"],
        source=row["source"],
        updated_at=row["updated_at"],
        updated_by=str(updated_by) if updated_by is not None else None,
    )


@router.get("", response_model=list[KeyStatusOut])
async def list_keys() -> list[KeyStatusOut]:
    rows = await KeyVault().list_status()
    return [_status_to_out(r) for r in rows]


@router.put("/{provider}", response_model=KeyStatusOut)
async def set_key(
    provider: str,
    body: SetKeyBody,
    current: User = Depends(require_admin),
) -> KeyStatusOut:
    _check_provider(provider)
    vault = KeyVault()

    # Validate before persisting so typos don't land in the DB.
    try:
        await _validate_with_provider(provider, body.api_key)
    except ProviderMissingKey as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": err.code, "message": err.message}},
        ) from err
    except ProviderError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": err.code, "message": err.message}},
        ) from err
    except Exception as err:
        # Provider client raised something unexpected — surface as a 400
        # so the operator sees what's wrong (typo, network, etc).
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": {
                    "code": "provider_validation_failed",
                    "message": str(err),
                }
            },
        ) from err

    await vault.set(provider, body.api_key, updated_by=current.id)

    # Echo the new status row so the UI can refresh without a follow-up GET.
    for row in await vault.list_status():
        if row["provider"] == provider:
            return _status_to_out(row)
    raise RuntimeError("provider row vanished after upsert")  # pragma: no cover


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(provider: str) -> Response:
    _check_provider(provider)
    await KeyVault().delete(provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
