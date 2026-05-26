"""GET /api/drafts/{id}/download — assembled markdown."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from pencraft.drafts import DraftStore

router = APIRouter(tags=["download"])


@router.get("/api/drafts/{draft_id}/download", response_class=PlainTextResponse)
def download_draft(draft_id: str, request: Request) -> PlainTextResponse:
    store: DraftStore = request.app.state.draft_store
    draft = store.get(draft_id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    md = store.assemble_markdown(draft)
    filename = (draft.title or draft.idea.topic).strip().replace(" ", "-") or "post"
    return PlainTextResponse(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}.md"'},
    )
