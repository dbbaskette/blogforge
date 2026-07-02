"""GET /api/drafts/{id}/download — export as Markdown, HTML, or .docx."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.models import Draft
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.export import EXPORT_FORMATS, to_docx, to_html, to_markdown

router = APIRouter(tags=["download"])

_DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _filename(draft: Draft) -> str:
    """ASCII-safe filename for the Content-Disposition header.

    HTTP headers are latin-1; titles use typographic punctuation (curly
    quotes, em dashes, smart apostrophes) that isn't — an unsanitized name
    raised UnicodeEncodeError (a 500) on download. Collapse anything outside
    a safe ASCII set to hyphens.
    """
    raw = (draft.title or draft.idea.topic).strip()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-.")
    return safe or "post"


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
        # Embed the hero image as a data URI so the exported file is self-contained.
        hero_data_uri: str | None = None
        if draft.hero_image_key:
            try:
                import base64

                from blogforge.s3.client import get_s3_client

                raw = await get_s3_client().get_object(draft.hero_image_key)
                hero_data_uri = f"data:image/png;base64,{base64.b64encode(raw).decode()}"
            except Exception:
                hero_data_uri = None
        return Response(
            content=to_html(draft, hero_data_uri=hero_data_uri, author=current.github_login),
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base}.html"'},
        )
    return Response(
        content=to_markdown(draft, frontmatter=frontmatter),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{base}.md"'},
    )
