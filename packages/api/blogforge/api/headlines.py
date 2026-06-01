"""POST /api/drafts/{id}/headlines — alternative titles or opening hooks."""
from __future__ import annotations

from typing import Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from myvoice.compose import ComposeError
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.headlines import generate_headlines
from blogforge.keys import KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider

router = APIRouter(tags=["headlines"])


class _HeadlinesBody(BaseModel):
    kind: Literal["title", "hook"]
    n: int = Field(default=5, ge=2, le=8)


@router.post("/api/drafts/{draft_id}/headlines")
async def headlines(
    draft_id: str,
    body: _HeadlinesBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
        )

    api_key = await KeyVault().get(draft.idea.provider)
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key for {draft.idea.provider}",
                    "hint": "An admin can add one under /admin (API keys section).",
                }
            },
        )

    manifest = yaml.safe_load(
        (pack_info.root_path / "stylepack.yaml").read_text(encoding="utf-8")
    ) or {}
    provider = get_provider(draft.idea.provider, api_key)
    try:
        options = await generate_headlines(
            draft,
            pack_info.root_path,
            manifest,
            provider,
            model=draft.idea.model,
            kind=body.kind,
            n=body.n,
        )
    except (ProviderMissingKey, ProviderError) as e:
        raise HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}
        ) from e
    except ComposeError as e:
        raise HTTPException(
            500,
            detail={
                "error": {
                    "code": "compose_error",
                    "message": str(e),
                    "hint": "Check the draft's format/samples against the pack manifest.",
                }
            },
        ) from e
    return {"kind": body.kind, "options": options}
