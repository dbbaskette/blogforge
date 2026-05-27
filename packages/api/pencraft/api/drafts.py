"""CRUD routes for drafts."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from pencraft.drafts import Draft, DraftStore, DraftSummary, IdeaInput

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


def _store(request: Request) -> DraftStore:
    store: DraftStore = request.app.state.draft_store
    return store


def _not_found(draft_id: str) -> HTTPException:
    return HTTPException(
        404,
        detail={"error": {"code": "draft_not_found", "message": f"No draft '{draft_id}'"}},
    )


@router.get("")
def list_drafts(request: Request) -> list[DraftSummary]:
    return _store(request).list()


@router.post("", status_code=201)
async def create_draft(idea: IdeaInput, request: Request) -> Draft:
    draft = _store(request).create(idea)
    await request.app.state.event_bus.emit(
        {"type": "draft:created", "id": draft.id, "title": draft.title}
    )
    return draft


@router.get("/{draft_id}")
def get_draft(draft_id: str, request: Request) -> Draft:
    draft = _store(request).get(draft_id)
    if draft is None:
        raise _not_found(draft_id)
    return draft


_STAGE_ORDER = {"idea": 0, "outline": 1, "sections": 2}


@router.put("/{draft_id}")
async def update_draft(draft_id: str, draft: Draft, request: Request) -> Draft:
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
    existing = store.get(draft_id)
    if existing is None:
        raise _not_found(draft_id)

    if _STAGE_ORDER[draft.stage] < _STAGE_ORDER[existing.stage]:
        draft.stage = existing.stage
    if draft.outline is None and existing.outline is not None:
        draft.outline = existing.outline
    if not draft.sections and existing.sections:
        draft.sections = existing.sections

    updated = store.update(draft_id, draft)
    await request.app.state.event_bus.emit(
        {"type": "draft:updated", "id": updated.id, "title": updated.title}
    )
    return updated


@router.delete("/{draft_id}", status_code=204)
async def delete_draft(draft_id: str, request: Request) -> None:
    store = _store(request)
    draft = store.get(draft_id)
    if draft is None:
        raise _not_found(draft_id)
    store.delete(draft_id)
    await request.app.state.event_bus.emit(
        {"type": "draft:deleted", "id": draft_id, "title": draft.title}
    )
