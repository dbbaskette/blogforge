"""POST /api/drafts/{id}/repurpose — turn a finished draft into another channel.

GET /api/repurpose/formats lists the available channels for the UI.
Synchronous: the outputs are short, so the request blocks on one
provider.complete() and returns the repurposed text.
"""

from __future__ import annotations

from typing import Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.models import Draft, OutlineProposal, OutlineSection
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.ingest import ingest_document
from blogforge.generate.repurpose import FORMATS, repurpose
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.voice.compose import ComposeError
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["repurpose"])


class _RepurposeBody(BaseModel):
    format: Literal[
        "summary",
        "extended",
        "x_thread",
        "linkedin",
        "linkedin_article",
        "newsletter",
        "tldr",
        "meta_description",
        "email",
    ]


VariationFormat = Literal["summary", "extended", "linkedin"]


class _SaveRepurposeBody(BaseModel):
    format: VariationFormat
    text: str = Field(min_length=1, max_length=200_000)


class _LengthResponse(BaseModel):
    metric: Literal["words", "characters"]
    actual: int
    minimum: int
    maximum: int
    within_target: bool
    correction_attempted: bool


class _RepurposeResponse(BaseModel):
    format: str
    text: str
    length: _LengthResponse | None = None


@router.get("/api/repurpose/formats")
async def list_formats(
    current: User = Depends(get_current_user),
) -> list[dict[str, str]]:
    return [{"id": key, "label": spec["label"]} for key, spec in FORMATS.items()]


@router.post("/api/drafts/{draft_id}/repurpose")
async def repurpose_draft(
    draft_id: str,
    body: _RepurposeBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> _RepurposeResponse:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    md = store.assemble_markdown(draft)
    if not md.strip() or not any(s.content_md.strip() for s in draft.sections):
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "empty_draft",
                    "message": "Write some sections before repurposing.",
                }
            },
        )

    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            raise HTTPException(
                404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
            )

    pack_root = await resolve_voice(draft, current.id, pack_store=pack_store)

    manifest = yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    provider = await build_provider_for(current.id, draft.idea.provider)
    try:
        result = await repurpose(
            draft,
            pack_root,
            manifest,
            provider,
            model=draft.idea.model,
            body=md,
            fmt=body.format,
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
    length = (
        None
        if result.length is None
        else _LengthResponse(
            metric=result.length.metric,
            actual=result.length.actual,
            minimum=result.length.minimum,
            maximum=result.length.maximum,
            within_target=result.length.within_target,
            correction_attempted=result.length.correction_attempted,
        )
    )
    return _RepurposeResponse(format=body.format, text=result.text, length=length)


@router.post(
    "/api/drafts/{draft_id}/repurpose/save",
    response_model=Draft,
    status_code=status.HTTP_201_CREATED,
)
async def save_repurposed_draft(
    draft_id: str,
    body: _SaveRepurposeBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    """Save an accepted length-controlled preview as a separate editable draft."""
    store: SqlDraftStore = request.app.state.draft_store
    source = await store.get(draft_id, user_id=current.id)
    if source is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "draft_not_found", "message": draft_id}},
        )

    text = body.text.strip()
    if not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": {
                    "code": "empty_preview",
                    "message": "Generate a preview before saving it.",
                }
            },
        )

    suffixes: dict[VariationFormat, str] = {
        "summary": "Summary",
        "extended": "Extended",
        "linkedin": "LinkedIn Post",
    }
    source_title = source.title.strip() or source.idea.topic.strip()
    title = f"{source_title} — {suffixes[body.format]}"
    word_count = len(text.split())
    idea = source.idea.model_copy(
        deep=True,
        update={
            "topic": title,
            "target_words": min(10_000, max(300, word_count)),
        },
    )
    ingested = ingest_document(f"# {title}\n\n{text}")

    saved = await store.create_complete(
        user_id=current.id,
        draft=Draft(
            title=title,
            stage="sections",
            idea=idea,
            sections=ingested.sections,
            outline=OutlineProposal(
                opening_hook=ingested.opening,
                sections=[
                    OutlineSection(id=section.id, title=section.title, brief=section.brief)
                    for section in ingested.sections
                ],
                estimated_words=word_count,
            ),
            tags=list(source.tags),
        ),
    )

    await request.app.state.event_bus.emit(
        {"type": "draft:created", "id": saved.id, "title": saved.title}
    )
    return saved
