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
    generate_alt_text,
    generate_citation,
    generate_faq,
    generate_opener,
    generate_queries,
    generate_quotes,
    generate_table,
    generate_takeaways,
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
    from blogforge.voice.sources_context import build_background_context

    bg = await build_background_context(current.id)
    try:
        return await analyze_geo(
            draft, pack_root, manifest, provider, model=draft.idea.model, extra_sources=bg or ""
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e


class _RescoreBody(BaseModel):
    # Which levers to re-score after a targeted fix. Others are left as-is.
    levers: list[str] = Field(min_length=1, max_length=12)


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
    from blogforge.voice.sources_context import build_background_context

    bg = await build_background_context(current.id)
    try:
        levers = await rescore_geo(
            draft, body.levers, pack_root, provider, model=draft.idea.model, extra_sources=bg or ""
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    return {"levers": levers}


class _FaqBody(BaseModel):
    n: int = Field(default=4, ge=2, le=8)
    # Specific reader questions to answer (e.g. sub-question coverage gaps). When
    # set, the generator answers only those the draft supports.
    questions: list[str] = Field(default_factory=list, max_length=8)


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
            draft, pack_root, manifest, provider, model=draft.idea.model, n=body.n,
            questions=body.questions or None,
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


class _QuotesBody(BaseModel):
    reference_id: str = Field(min_length=1)


@router.post("/api/drafts/{draft_id}/geo/quotes")
async def geo_quotes(
    draft_id: str,
    body: _QuotesBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    """VERBATIM quote candidates from one attached reference's extracted text —
    non-verbatim model output is filtered out server-side (the honesty guard)."""
    draft, _pack_root, _manifest, provider = await _load(request, draft_id, current)
    ref = next((r for r in draft.references if r.id == body.reference_id), None)
    if ref is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "reference_not_found", "message": body.reference_id}},
        )
    from blogforge.s3 import S3Error, get_s3_client

    try:
        extracted = (
            await get_s3_client().get_object(
                f"drafts/{draft_id}/references/extracted/{ref.id}.md"
            )
        ).decode("utf-8")
    except S3Error as e:
        raise HTTPException(
            502, detail={"error": {"code": "reference_unreadable", "message": str(e)}}
        ) from e
    try:
        quotes = await generate_quotes(extracted, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    return {"quotes": quotes}


class _CiteBody(BaseModel):
    section_id: str = Field(min_length=1)
    target: str = Field(min_length=1)
    reference_id: str = Field(min_length=1)
    quote: str | None = None


@router.post("/api/drafts/{draft_id}/geo/cite")
async def geo_cite(
    draft_id: str,
    body: _CiteBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    """Rewrite one passage to attribute (+ link) an attached reference — the
    cite_reference / quote_reference fix. Client splices `passage` over `target`."""
    draft, pack_root, _manifest, provider = await _load(request, draft_id, current)
    if not any(s.id == body.section_id for s in draft.sections):
        raise HTTPException(
            404, detail={"error": {"code": "section_not_found", "message": body.section_id}}
        )
    ref = next((r for r in draft.references if r.id == body.reference_id), None)
    if ref is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "reference_not_found", "message": body.reference_id}},
        )
    try:
        passage = await generate_citation(
            body.target, ref.name, ref.url, pack_root, provider,
            model=draft.idea.model, quote=body.quote,
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    if not passage:
        raise HTTPException(
            502,
            detail={
                "error": {"code": "empty_citation", "message": "Nothing came back — try again."}
            },
        )
    return {"passage": passage}


@router.post("/api/drafts/{draft_id}/geo/takeaways")
async def geo_takeaways(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    """Grounded key-takeaways bullets — the client appends them as a TL;DR block
    at the top of the draft (tracked for undo/removal)."""
    draft, pack_root, _manifest, provider = await _load(request, draft_id, current)
    try:
        takeaways = await generate_takeaways(draft, pack_root, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    if not takeaways:
        raise HTTPException(
            502,
            detail={"error": {"code": "empty_takeaways", "message": "Nothing came back — retry."}},
        )
    return {"takeaways": takeaways}


class _AltBody(BaseModel):
    target: str = Field(min_length=1)


@router.post("/api/drafts/{draft_id}/geo/alt")
async def geo_alt(
    draft_id: str,
    body: _AltBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    """Descriptive alt text for one image, from its section's prose. The client
    splices it into the image markdown's empty alt slot."""
    draft, _pack_root, _manifest, provider = await _load(request, draft_id, current)
    section_text = next(
        (s.content_md for s in draft.sections if body.target in s.content_md), ""
    )
    try:
        alt = await generate_alt_text(body.target, section_text, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    if not alt:
        raise HTTPException(
            502, detail={"error": {"code": "empty_alt", "message": "Nothing came back — retry."}}
        )
    return {"alt": alt}


@router.post("/api/drafts/{draft_id}/geo/queries")
async def geo_queries(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    """Natural-language queries this post should be the canonical answer for —
    for the writer's manual weekly citation checks in ChatGPT/Perplexity/AIO."""
    draft, pack_root, _manifest, provider = await _load(request, draft_id, current)
    try:
        queries = await generate_queries(draft, pack_root, provider, model=draft.idea.model)
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
    if not queries:
        raise HTTPException(
            502,
            detail={"error": {"code": "empty_queries", "message": "Nothing came back — retry."}},
        )
    return {"queries": queries}


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
