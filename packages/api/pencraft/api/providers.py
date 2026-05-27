"""GET /api/providers — availability via KeyVault (admin-managed keys with
myvoice fallback)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from pencraft.keys import SUPPORTED_PROVIDERS, KeyVault

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("")
async def list_providers() -> dict[str, bool]:
    """Return availability map; never includes the keys themselves."""
    vault = KeyVault()
    return {p: bool(await vault.get(p)) for p in SUPPORTED_PROVIDERS}


@router.get("/{provider}/models")
async def list_models(provider: str) -> list[dict[str, Any]]:
    """Proxy to the provider's list_models, using the admin-managed key
    (or the myvoice fallback if nothing's stored)."""
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            404,
            detail={
                "error": {
                    "code": "unknown_provider",
                    "message": f"Unknown provider '{provider}'",
                }
            },
        )
    api_key = await KeyVault().get(provider)
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key configured for {provider}.",
                    "hint": "An admin can add one under /admin (API keys section).",
                }
            },
        )
    from pencraft.llm.exceptions import ProviderError, ProviderMissingKey
    from pencraft.llm.registry import get_provider

    try:
        client = get_provider(provider, api_key)
        models = await client.list_models()
    except ProviderMissingKey as e:
        raise HTTPException(
            400,
            detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}},
        ) from e
    except ProviderError as e:
        raise HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message}}
        ) from e
    return [m.model_dump() for m in models]
