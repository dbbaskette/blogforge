"""Draft CRUD routes — user-scoped via Postgres."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.models import (
    Draft,
    DraftStage,
    DraftSummary,
    IdeaInput,
    OutlineProposal,
    OutlineSection,
)
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.ingest import ingest_document

router = APIRouter(prefix="/api/drafts", tags=["drafts"])

_MAX_TAGS = 20
_MAX_TAG_LEN = 40


class _TagsBody(BaseModel):
    tags: list[str]


class _StageBody(BaseModel):
    stage: DraftStage


def _normalize_tags(raw: list[str]) -> list[str]:
    """Trim, drop blanks, cap length, dedupe case-insensitively (first wins),
    and cap the count — so the list stays tidy regardless of client input."""
    seen: set[str] = set()
    out: list[str] = []
    for tag in raw:
        cleaned = tag.strip()[:_MAX_TAG_LEN].strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= _MAX_TAGS:
            break
    return out


def _store(request: Request) -> SqlDraftStore:
    store: SqlDraftStore = request.app.state.draft_store
    return store


def _not_found(draft_id: str) -> HTTPException:
    return HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail={"error": {"code": "draft_not_found", "message": f"No draft '{draft_id}'"}},
    )


@router.get("", response_model=list[DraftSummary])
async def list_drafts(
    request: Request, current: User = Depends(get_current_user)
) -> list[DraftSummary]:
    return await _store(request).list_for_user(current.id)


# NOTE: declared before GET /{draft_id} so "trash" isn't captured as an id.
@router.get("/trash", response_model=list[DraftSummary])
async def list_trashed(
    request: Request, current: User = Depends(get_current_user)
) -> list[DraftSummary]:
    """Soft-deleted drafts, recoverable via POST /{id}/restore."""
    return await _store(request).list_trashed(current.id)


@router.post("/{draft_id}/restore", response_model=Draft)
async def restore_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    restored = await _store(request).restore(draft_id, user_id=current.id)
    if restored is None:
        raise _not_found(draft_id)
    await request.app.state.event_bus.emit(
        {"type": "draft:restored", "id": draft_id, "title": restored.title}
    )
    return restored


@router.post("", response_model=Draft, status_code=status.HTTP_201_CREATED)
async def create_draft(
    idea: IdeaInput,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    draft = await _store(request).create(user_id=current.id, idea=idea)
    await request.app.state.event_bus.emit(
        {"type": "draft:created", "id": draft.id, "title": draft.title}
    )
    return draft


class _ImportBody(BaseModel):
    """A finished draft pasted in the "I already wrote it" compose mode.

    Topic is derived from the paste (first H1 / first line), so only the voice
    + provider setup travels alongside the text.
    """

    text: str = Field(min_length=1, max_length=200_000)
    pack_slug: str = ""
    format: str | None = None
    provider: Literal["anthropic", "openai", "google", "claude-cli", "tanzu"]
    model: str = Field(min_length=1)
    target_words: int = Field(default=1500, ge=300, le=10000)
    use_voice_profile: bool = True


# NOTE: declared before GET /{draft_id}; distinct method+path so no capture.
@router.post("/import", response_model=Draft, status_code=status.HTTP_201_CREATED)
async def import_draft(
    body: _ImportBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    """Ingest a pasted draft into an editable, sections-stage draft.

    Splits the text on H2 headings (single section if none); prose before the
    first heading becomes the article's opening (``outline.opening_hook``), kept
    above the sections rather than folded under the first heading. Lands as a
    normal draft so every shaping tool works on it unchanged. Nothing is
    rewritten and no tool is auto-run — the writer's words are preserved verbatim.
    """
    ingested = ingest_document(body.text)
    if not ingested.sections:
        raise HTTPException(
            422,
            detail={"error": {"code": "empty_draft", "message": "Paste some text to import."}},
        )

    idea = IdeaInput(
        topic=ingested.title,
        pack_slug=body.pack_slug,
        format=body.format,
        provider=body.provider,
        model=body.model,
        target_words=body.target_words,
        use_voice_profile=body.use_voice_profile,
    )
    store = _store(request)
    draft = await store.create(user_id=current.id, idea=idea)
    draft.title = ingested.title
    draft.sections = ingested.sections
    draft.outline = OutlineProposal(
        opening_hook=ingested.opening,
        sections=[OutlineSection(id=s.id, title=s.title) for s in ingested.sections],
    )
    draft.stage = "sections"
    updated = await store.update(draft.id, draft, user_id=current.id)
    if updated is None:  # pragma: no cover — draft was just created
        raise _not_found(draft.id)
    await request.app.state.event_bus.emit(
        {"type": "draft:created", "id": updated.id, "title": updated.title}
    )
    return updated


@router.get("/{draft_id}", response_model=Draft)
async def get_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found(draft_id)
    return draft


@router.get("/{draft_id}/active-job")
async def get_active_job(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str | None]:
    """The id of an in-flight compose/revise job for this draft, if any —
    so a reloaded client can re-attach to its SSE stream. `null` when idle."""
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found(draft_id)
    reg = request.app.state.job_registry
    job = reg.active_for_draft(draft_id)
    return {"job_id": job.id if job else None}


_STAGE_ORDER = {"research": 0, "outline": 1, "sections": 2}


@router.post("/{draft_id}/stage", response_model=Draft)
async def set_draft_stage(
    draft_id: str,
    body: _StageBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    """Jump a draft to a stage it has reached — e.g. back to 'research' to
    rework in the chat. Content (outline / sections / chat) is preserved;
    only the stage pointer moves. You can't *advance* to a stage that has no
    content yet (use the normal generate/compose flow for that)."""
    store = _store(request)
    existing = await store.get(draft_id, user_id=current.id)
    if existing is None:
        raise _not_found(draft_id)
    if body.stage == "outline" and existing.outline is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"error": {"code": "invalid_stage", "message": "No outline yet."}},
        )
    if body.stage == "sections" and not existing.sections:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"error": {"code": "invalid_stage", "message": "No sections yet."}},
        )
    updated = await store.set_stage(draft_id, body.stage, user_id=current.id)
    if updated is None:
        raise _not_found(draft_id)
    await request.app.state.event_bus.emit(
        {"type": "draft:updated", "id": updated.id, "title": updated.title}
    )
    return updated


@router.put("/{draft_id}", response_model=Draft)
async def update_draft(
    draft_id: str,
    draft: Draft,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    """Update a draft. Guards against client-side stale writes:

    Stage 1's auto-save can race with Generate outline + Expand sections,
    and would otherwise clobber server-side outline/sections back to empty.
    Rules:
      - stage never regresses (idea < outline < sections)
      - if the body's outline is null but disk has one, keep disk's
      - if the body's sections is empty but disk has some, keep disk's
    The idea / title fields are always writable.
    """
    store = _store(request)
    existing = await store.get(draft_id, user_id=current.id)
    if existing is None:
        raise _not_found(draft_id)

    if _STAGE_ORDER[draft.stage] < _STAGE_ORDER[existing.stage]:
        draft.stage = existing.stage
    if draft.outline is None and existing.outline is not None:
        draft.outline = existing.outline
    if not draft.sections and existing.sections:
        draft.sections = existing.sections

    updated = await store.update(draft_id, draft, user_id=current.id)
    if updated is None:
        raise _not_found(draft_id)
    await request.app.state.event_bus.emit(
        {"type": "draft:updated", "id": updated.id, "title": updated.title}
    )
    return updated


@router.patch("/{draft_id}/tags", response_model=Draft)
async def set_draft_tags(
    draft_id: str,
    body: _TagsBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    """Replace a draft's tags. Lightweight — used by the drafts list to
    organize without loading/saving the whole draft."""
    updated = await _store(request).set_tags(
        draft_id, _normalize_tags(body.tags), user_id=current.id
    )
    if updated is None:
        raise _not_found(draft_id)
    await request.app.state.event_bus.emit(
        {"type": "draft:updated", "id": updated.id, "title": updated.title}
    )
    return updated


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    draft_id: str,
    request: Request,
    hard: bool = False,
    current: User = Depends(get_current_user),
) -> None:
    """Soft-delete (move to trash) by default. `?hard=true` permanently
    removes an already-trashed draft."""
    store = _store(request)
    if hard:
        ok = await store.hard_delete(draft_id, user_id=current.id)
        if not ok:
            raise _not_found(draft_id)
        await request.app.state.event_bus.emit({"type": "draft:purged", "id": draft_id})
        return
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found(draft_id)
    await store.delete(draft_id, user_id=current.id)
    await request.app.state.event_bus.emit(
        {"type": "draft:deleted", "id": draft_id, "title": draft.title}
    )
