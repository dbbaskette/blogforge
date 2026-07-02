"""GET /api/providers — availability via KeyVault (per-user keys)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from blogforge.auth.dependencies import get_current_user
from blogforge.config import get_settings
from blogforge.db.models import User
from blogforge.keys import SUPPORTED_PROVIDERS, KeyVault

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("")
async def list_providers(current: User = Depends(get_current_user)) -> dict[str, bool]:
    """Return availability map; never includes the keys themselves."""
    from blogforge.llm.claude_cli import claude_available

    vault = KeyVault(current.id)
    out = {p: bool(await vault.get(p)) for p in SUPPORTED_PROVIDERS}
    # claude-cli isn't key-managed; it's available iff the binary is installed.
    out["claude-cli"] = claude_available()
    s = get_settings()
    out["tanzu"] = bool(s.tanzu_api_base and s.tanzu_api_key)
    return out


@router.get("/claude-cli/status")
async def claude_cli_status(current: User = Depends(get_current_user)) -> dict[str, object]:
    """Live status of the keyless Claude CLI provider: installed + logged in?
    Runs a tiny `claude -p` probe (uses the host's Claude Code auth). Declared
    before /{provider}/models so the static path wins."""
    from blogforge.llm.claude_cli import claude_status

    return await claude_status()


@router.get("/{provider}/models")
async def list_models(provider: str, current: User = Depends(get_current_user)) -> list[dict[str, Any]]:
    """Proxy to the provider's list_models, using the per-user key."""
    # claude-cli is keyless (CLI auth) — list its models without a vault key.
    if provider == "claude-cli":
        from blogforge.llm.claude_cli import ClaudeCliProvider

        models = await ClaudeCliProvider().list_models()
        return [m.model_dump() for m in models]
    # tanzu is bound-service-managed — list its models without a per-user vault key.
    if provider == "tanzu":
        from blogforge.llm.registry import get_provider

        return [m.model_dump() for m in await get_provider("tanzu", "").list_models()]
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
    api_key = await KeyVault(current.id).get(provider)
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key configured for {provider}.",
                    "hint": "Add your key in Settings → Provider API keys.",
                }
            },
        )
    from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
    from blogforge.llm.registry import get_provider

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
