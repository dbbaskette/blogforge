"""GET /api/providers — read myvoice's config for available keys."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _myvoice_config_path() -> Path:
    env = os.environ.get("MYVOICE_CONFIG_PATH")
    if env:
        return Path(env)
    return Path.home() / ".myvoice" / "config.yaml"


def _read_keys() -> dict[str, str]:
    """Return {provider_name: api_key_or_empty} for the 3 providers."""
    path = _myvoice_config_path()
    if not path.is_file():
        return {"anthropic": "", "openai": "", "google": ""}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    providers = data.get("providers") or {}
    return {
        name: (providers.get(name) or {}).get("api_key", "")
        for name in ("anthropic", "openai", "google")
    }


@router.get("")
def list_providers() -> dict[str, bool]:
    """Return availability map; never includes the keys themselves."""
    keys = _read_keys()
    return {name: bool(key) for name, key in keys.items()}


@router.get("/{provider}/models")
async def list_models(provider: str) -> list[dict[str, Any]]:
    """Proxy to the provider's list_models, using the key from myvoice's config."""
    if provider not in ("anthropic", "openai", "google"):
        raise HTTPException(
            404,
            detail={
                "error": {
                    "code": "unknown_provider",
                    "message": f"Unknown provider '{provider}'",
                }
            },
        )
    keys = _read_keys()
    api_key = keys.get(provider, "")
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key for {provider} in ~/.myvoice/config.yaml",
                    "hint": "Open myvoice (localhost:7878) and add a key in Settings.",
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
