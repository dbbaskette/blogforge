"""POST /api/drafts/{id}/inline — voice-aware transform of a selected passage.

Synchronous (not job-based): inline edits are short fragments, so the request
blocks on a single provider.complete() call and returns the rewritten text.
"""
from __future__ import annotations

from typing import Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from blogforge.voice.compose import ComposeError
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.inline import transform_text
from blogforge.keys import KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["inline"])

# Selections longer than this are almost certainly "rewrite the whole section"
# — which is what regenerate/revise are for. Keep inline edits fragment-sized.
_MAX_CHARS = 4000


class _InlineBody(BaseModel):
    text: str = Field(min_length=1, max_length=_MAX_CHARS)
    action: Literal["rephrase", "shorten", "expand", "fix", "custom"]
    instruction: str = ""


@router.post("/api/drafts/{draft_id}/inline")
async def inline_edit(
    draft_id: str,
    body: _InlineBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            raise HTTPException(
                404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
            )

    pack_root = await resolve_voice(draft, current.id, pack_store=pack_store)

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
        (pack_root / "stylepack.yaml").read_text(encoding="utf-8")
    ) or {}
    provider = get_provider(draft.idea.provider, api_key)
    try:
        result = await transform_text(
            draft,
            pack_root,
            manifest,
            provider,
            model=draft.idea.model,
            text=body.text,
            action=body.action,
            instruction=body.instruction,
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
    return {"text": result}
