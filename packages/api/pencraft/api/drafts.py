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


@router.put("/{draft_id}")
async def update_draft(draft_id: str, draft: Draft, request: Request) -> Draft:
    store = _store(request)
    if store.get(draft_id) is None:
        raise _not_found(draft_id)
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
