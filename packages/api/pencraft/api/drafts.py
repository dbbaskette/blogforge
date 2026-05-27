"""Draft CRUD routes — user-scoped via Postgres."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.drafts.models import Draft, DraftSummary, IdeaInput
from pencraft.drafts.sql_store import SqlDraftStore

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


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


_STAGE_ORDER = {"idea": 0, "outline": 1, "sections": 2}


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


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> None:
    store = _store(request)
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found(draft_id)
    await store.delete(draft_id, user_id=current.id)
    await request.app.state.event_bus.emit(
        {"type": "draft:deleted", "id": draft_id, "title": draft.title}
    )
