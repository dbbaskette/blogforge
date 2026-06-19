"""Per-user provider API keys (Settings)."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.keys import SUPPORTED_PROVIDERS, KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider

router = APIRouter(prefix="/api/keys", tags=["keys"])


class KeyBody(BaseModel):
    api_key: str


def _check(provider: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(404, detail={"error": {"code": "unknown_provider",
            "message": f"Unknown provider '{provider}'"}})


@router.get("")
async def status_map(current: User = Depends(get_current_user)) -> dict[str, bool]:
    return await KeyVault(current.id).list_status()


@router.put("/{provider}")
async def set_key(provider: str, body: KeyBody, current: User = Depends(get_current_user)) -> dict[str, str]:
    _check(provider)
    if not body.api_key.strip():
        raise HTTPException(400, detail={"error": {"code": "empty_key", "message": "Key must not be empty."}})
    try:
        await get_provider(provider, body.api_key).list_models()
    except (ProviderError, ProviderMissingKey) as exc:
        raise HTTPException(400, detail={"error": {"code": "invalid_key", "message": str(exc)}}) from exc
    await KeyVault(current.id).set(provider, body.api_key)
    return {"status": "ok"}


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(provider: str, current: User = Depends(get_current_user)) -> Response:
    _check(provider)
    await KeyVault(current.id).delete(provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
