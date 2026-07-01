"""POST /api/drafts/{id}/suggest — the Shape Assistant's suggestion passes.

Runs fact-check / reword / expand passes over a whole draft and returns a
grouped punch-list. Mirrors the headlines endpoint: resolve the voice, load the
manifest, build the provider, delegate to the generator.
"""
from __future__ import annotations

from typing import get_args

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.suggest import ALL_KINDS, SuggestKind, suggest_improvements
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.voice.compose import ComposeError
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["suggest"])

_VALID_KINDS = set(get_args(SuggestKind))


class _SuggestBody(BaseModel):
    # Which passes to run; defaults to all three.
    kinds: list[str] = Field(default_factory=lambda: list(ALL_KINDS))
    per_kind: int = Field(default=4, ge=2, le=6)


@router.post("/api/drafts/{draft_id}/suggest")
async def suggest(
    draft_id: str,
    body: _SuggestBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    kinds = tuple(k for k in body.kinds if k in _VALID_KINDS) or ALL_KINDS

    if not draft.idea.use_voice_profile:
        if pack_store.get(draft.idea.pack_slug) is None:
            raise HTTPException(
                404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
            )

    pack_root = await resolve_voice(draft, current.id, pack_store=pack_store)
    manifest = yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    provider = await build_provider_for(current.id, draft.idea.provider)
    try:
        suggestions = await suggest_improvements(
            draft,
            pack_root,
            manifest,
            provider,
            model=draft.idea.model,
            kinds=kinds,  # type: ignore[arg-type]
            per_kind=body.per_kind,
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
                    "hint": "Check your voice profile / pack manifest.",
                }
            },
        ) from e
    return {"suggestions": suggestions}
