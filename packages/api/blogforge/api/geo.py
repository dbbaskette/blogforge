"""POST /api/drafts/{id}/geo — GEO readiness report + FAQ generation.

Mirrors the headlines/suggest endpoints: resolve the voice, load the manifest,
build the provider, delegate to the generator. The report combines deterministic
structural checks with one voice-aware LLM pass.
"""

from __future__ import annotations

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.geo import (
    analyze_geo,
    generate_faq,
    generate_opener,
    generate_table,
    rescore_geo,
)
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.voice.compose import ComposeError
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["geo"])


async def _load(request: Request, draft_id: str, user: User):  # type: ignore[no-untyped-def]
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store
    draft = await store.get(draft_id, user_id=user.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    if not draft.idea.use_voice_profile and pack_store.get(draft.idea.pack_slug) is None:
        raise HTTPException(
            404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
        )
    pack_root = await resolve_voice(draft, user.id, pack_store=pack_store)
    manifest = yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    provider = await build_provider_for(user.id, draft.idea.provider)
    return draft, pack_root, manifest, provider


def _provider_error(e: Exception) -> HTTPException:
    if isinstance(e, (ProviderMissingKey, ProviderError)):
        return HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}
        )
    return HTTPException(
        500,
        detail={
            "error": {
                "code": "compose_error",
                "message": str(e),
                "hint": "Check your voice profile / pack manifest.",
            }
        },
    )


@router.post("/api/drafts/{draft_id}/geo")
async def geo_report(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    draft, pack_root, manifest, provider = await _load(request, draft_id, current)
    try:
        return await analyze_geo(draft, pack_root, manifest, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e


class _RescoreBody(BaseModel):
    # Which levers to re-score after a targeted fix (1-9). Others are left as-is.
    levers: list[str] = Field(min_length=1, max_length=9)


@router.post("/api/drafts/{draft_id}/geo/rescore")
async def geo_rescore(
    draft_id: str,
    body: _RescoreBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    """Re-score only the given levers (after applying one fix) and return just
    those — the client merges them into the report without a full re-analysis."""
    draft, pack_root, _manifest, provider = await _load(request, draft_id, current)
    try:
        levers = await rescore_geo(draft, body.levers, pack_root, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    return {"levers": levers}


class _FaqBody(BaseModel):
    n: int = Field(default=4, ge=2, le=8)


@router.post("/api/drafts/{draft_id}/geo/faq")
async def geo_faq(
    draft_id: str,
    body: _FaqBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    draft, pack_root, manifest, provider = await _load(request, draft_id, current)
    try:
        faqs = await generate_faq(
            draft, pack_root, manifest, provider, model=draft.idea.model, n=body.n
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    return {"faqs": faqs}


class _TableBody(BaseModel):
    section_id: str = Field(min_length=1)


@router.post("/api/drafts/{draft_id}/geo/table")
async def geo_table(
    draft_id: str,
    body: _TableBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    """A grounded Markdown comparison table built from one section's prose — the
    client splices it into that section."""
    draft, pack_root, manifest, provider = await _load(request, draft_id, current)
    try:
        table = await generate_table(
            draft, body.section_id, pack_root, manifest, provider, model=draft.idea.model
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    if not table:
        raise HTTPException(
            502,
            detail={"error": {"code": "empty_table", "message": "No table came back — try again."}},
        )
    return {"table": table}


@router.post("/api/drafts/{draft_id}/geo/opener")
async def geo_opener(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    """One citable definitional sentence, generated from the draft — the client
    prepends it verbatim so it can also be removed verbatim (undo)."""
    draft, pack_root, manifest, provider = await _load(request, draft_id, current)
    try:
        opener = await generate_opener(draft, pack_root, manifest, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    if not opener:
        raise HTTPException(
            502,
            detail={
                "error": {"code": "empty_opener", "message": "No opener came back — try again."}
            },
        )
    return {"opener": opener}
