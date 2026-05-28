"""References routes — /api/drafts/{id}/references/...

Endpoints (all `get_current_user`-gated, all draft-scoped):

  POST /api/drafts/{id}/references/url — add by URL

Subsequent tasks layer in pasted text, file uploads, listing, and
deletion. Storage layout (per spec §"Storage layout (S3)"):

  drafts/{draft_id}/references/
    originals/{ref_id}{ext}    ← raw upload / URL stub
    extracted/{ref_id}.md      ← cleaned markdown the LLM sees

Cross-user access silently 404s — never 403 — so the existence of a
draft owned by another user can't be probed via this surface.
"""
from __future__ import annotations

import asyncio
import secrets
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from pencraft.auth.dependencies import get_current_user
from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import Reference as ReferenceRow
from pencraft.db.models import User
from pencraft.drafts.models import Reference
from pencraft.drafts.sql_store import SqlDraftStore
from pencraft.references.extractors import (
    ExtractionResult,
    extract_url,
    file_extension_for_kind,
)
from pencraft.s3 import get_s3_client

router = APIRouter(prefix="/api/drafts", tags=["references"])


# 5 MB raw cap on uploads, per spec §"Extraction".
MAX_RAW_BYTES = 5 * 1024 * 1024


# ---------- shapes ----------


class UrlReferenceBody(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    name: str | None = Field(default=None, max_length=500)


def _store(request: Request) -> SqlDraftStore:
    store: SqlDraftStore = request.app.state.draft_store
    return store


def _not_found(message: str = "draft_not_found") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": {"code": message, "message": message}},
    )


def _ref_id() -> str:
    """Short, URL-safe reference id (`ref-<12 hex>`)."""
    return f"ref-{secrets.token_hex(6)}"


def _originals_key(draft_id: str, ref_id: str, ext: str) -> str:
    return f"drafts/{draft_id}/references/originals/{ref_id}{ext}"


def _extracted_key(draft_id: str, ref_id: str) -> str:
    return f"drafts/{draft_id}/references/extracted/{ref_id}.md"


async def _persist(
    *,
    draft_id_str: str,
    draft_uuid: UUID,
    kind: Literal["url", "file", "text"],
    extraction: ExtractionResult,
    original_bytes: bytes,
    original_ext: str,
    url: str | None = None,
    original_filename: str | None = None,
) -> Reference:
    """Write both S3 objects + insert the DB row. Returns the pydantic model."""
    s3 = get_s3_client()
    ref_id = _ref_id()

    # Both S3 writes go in parallel; both must succeed before the DB insert.
    await asyncio.gather(
        s3.put_object(
            _originals_key(draft_id_str, ref_id, original_ext),
            original_bytes,
            "application/octet-stream",
        ),
        s3.put_object(
            _extracted_key(draft_id_str, ref_id),
            extraction.extracted.encode("utf-8"),
            "text/markdown; charset=utf-8",
        ),
    )

    async with get_sessionmaker()() as session:
        row = ReferenceRow(
            id=ref_id,
            draft_id=draft_uuid,
            kind=kind,
            name=extraction.name,
            url=url,
            original_filename=original_filename,
            extracted_chars=extraction.extracted_chars,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return Reference(
            id=row.id,
            kind=row.kind,  # type: ignore[arg-type]
            name=row.name,
            url=row.url,
            original_filename=row.original_filename,
            extracted_chars=row.extracted_chars,
            added_at=row.added_at,
        )


async def _resolve_draft(request: Request, draft_id: str, current: User) -> UUID:
    """Return the draft's UUID, or raise 404 (also catches cross-user access)."""
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found()
    return UUID(draft.id)


# ---------- POST /references/url ----------


@router.post(
    "/{draft_id}/references/url",
    response_model=Reference,
    status_code=status.HTTP_201_CREATED,
)
async def add_url_reference(
    draft_id: str,
    body: UrlReferenceBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Reference:
    draft_uuid = await _resolve_draft(request, draft_id, current)

    try:
        extraction = await extract_url(body.url)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": {"code": "url_fetch_failed", "message": str(err)}},
        ) from err

    # User-supplied name overrides the extractor's title guess.
    if body.name:
        extraction = ExtractionResult(
            name=body.name,
            extracted=extraction.extracted,
            extracted_chars=extraction.extracted_chars,
        )

    return await _persist(
        draft_id_str=draft_id,
        draft_uuid=draft_uuid,
        kind="url",
        extraction=extraction,
        original_bytes=body.url.encode("utf-8"),
        original_ext=file_extension_for_kind("url"),
        url=body.url,
    )
