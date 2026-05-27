"""GET /api/drafts/{id}/download — assembled markdown."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.drafts.sql_store import SqlDraftStore

router = APIRouter(tags=["download"])


@router.get("/api/drafts/{draft_id}/download", response_class=PlainTextResponse)
async def download_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> PlainTextResponse:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    md = store.assemble_markdown(draft)
    filename = (draft.title or draft.idea.topic).strip().replace(" ", "-") or "post"
    return PlainTextResponse(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}.md"'},
    )
