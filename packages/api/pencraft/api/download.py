"""GET /api/drafts/{id}/download — export as Markdown, HTML, or .docx."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.drafts.models import Draft
from pencraft.drafts.sql_store import SqlDraftStore
from pencraft.export import EXPORT_FORMATS, to_docx, to_html, to_markdown

router = APIRouter(tags=["download"])

_DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _filename(draft: Draft) -> str:
    return (draft.title or draft.idea.topic).strip().replace(" ", "-") or "post"


@router.get("/api/drafts/{draft_id}/download")
async def download_draft(
    draft_id: str,
    request: Request,
    format: str = "md",
    frontmatter: bool = False,
    current: User = Depends(get_current_user),
) -> Response:
    """Export a draft. `format` is one of md | html | docx; `frontmatter=true`
    prepends a YAML block to the Markdown export."""
    if format not in EXPORT_FORMATS:
        raise HTTPException(
            422,
            detail={
                "error": {
                    "code": "unsupported_format",
                    "message": f"format must be one of {', '.join(EXPORT_FORMATS)}",
                }
            },
        )
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    base = _filename(draft)
    if format == "docx":
        return Response(
            content=to_docx(draft),
            media_type=_DOCX_MEDIA,
            headers={"Content-Disposition": f'attachment; filename="{base}.docx"'},
        )
    if format == "html":
        return Response(
            content=to_html(draft),
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base}.html"'},
        )
    return Response(
        content=to_markdown(draft, frontmatter=frontmatter),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{base}.md"'},
    )
