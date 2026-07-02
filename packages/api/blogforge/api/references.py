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

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import select

from blogforge.auth.dependencies import get_current_user
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import Reference as ReferenceRow
from blogforge.db.models import User
from blogforge.drafts.models import Reference
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.references.extractors import (
    ExtractionResult,
    UnsupportedFileType,
    extract_file,
    extract_text,
    extract_url,
    file_extension_for_kind,
)
from blogforge.s3 import S3Error, get_s3_client

router = APIRouter(prefix="/api/drafts", tags=["references"])


# 5 MB raw cap on uploads, per spec §"Extraction".
MAX_RAW_BYTES = 5 * 1024 * 1024


# ---------- shapes ----------


class UrlReferenceBody(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    name: str | None = Field(default=None, max_length=500)


class TextReferenceBody(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1)


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


async def ingest_url_reference(
    draft_id_str: str, draft_uuid: UUID, url: str, name: str | None = None
) -> Reference:
    """Fetch a URL, extract clean text, and persist it as a 'url' reference.

    Shared by the /references/url endpoint and compose-start (create_draft).
    Raises ValueError on fetch/extract failure (propagated from extract_url)."""
    extraction = await extract_url(url)
    if name:
        extraction = ExtractionResult(
            name=name,
            extracted=extraction.extracted,
            extracted_chars=extraction.extracted_chars,
        )
    return await _persist(
        draft_id_str=draft_id_str,
        draft_uuid=draft_uuid,
        kind="url",
        extraction=extraction,
        original_bytes=url.encode("utf-8"),
        original_ext=file_extension_for_kind("url"),
        url=url,
    )


async def _resolve_draft(request: Request, draft_id: str, current: User) -> UUID:
    """Return the draft's UUID, or raise 404 (also catches cross-user access)."""
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found()
    return UUID(draft.id)


# ---------- GET /references ----------


@router.get("/{draft_id}/references", response_model=list[Reference])
async def list_references(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> list[Reference]:
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found()
    return draft.references


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
        # User-supplied name overrides the extractor's title guess.
        return await ingest_url_reference(draft_id, draft_uuid, body.url, body.name or None)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": {"code": "url_fetch_failed", "message": str(err)}},
        ) from err


# ---------- POST /references/text ----------


@router.post(
    "/{draft_id}/references/text",
    response_model=Reference,
    status_code=status.HTTP_201_CREATED,
)
async def add_text_reference(
    draft_id: str,
    body: TextReferenceBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Reference:
    draft_uuid = await _resolve_draft(request, draft_id, current)
    if len(body.content.encode("utf-8")) > MAX_RAW_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail={
                "error": {
                    "code": "file_too_large",
                    "message": "pasted text exceeds 5 MB",
                }
            },
        )
    extraction = extract_text(body.name, body.content)
    return await _persist(
        draft_id_str=draft_id,
        draft_uuid=draft_uuid,
        kind="text",
        extraction=extraction,
        original_bytes=body.content.encode("utf-8"),
        original_ext=file_extension_for_kind("text"),
    )


# ---------- POST /references/file ----------


@router.post(
    "/{draft_id}/references/file",
    response_model=Reference,
    status_code=status.HTTP_201_CREATED,
)
async def add_file_reference(
    draft_id: str,
    request: Request,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    current: User = Depends(get_current_user),
) -> Reference:
    draft_uuid = await _resolve_draft(request, draft_id, current)

    filename = file.filename or "upload"
    raw = await file.read()
    # Size check BEFORE extension dispatch so a giant unsupported file
    # still 413s rather than wasting an extraction attempt.
    if len(raw) > MAX_RAW_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail={
                "error": {"code": "file_too_large", "message": "upload exceeds 5 MB"}
            },
        )
    try:
        ext = file_extension_for_kind("file", filename)
    except UnsupportedFileType as err:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "error": {
                    "code": "unsupported_file_type",
                    "message": f"unsupported extension: {err.ext!r}",
                }
            },
        ) from err

    try:
        extraction = extract_file(filename, raw)
    except UnsupportedFileType as err:  # pragma: no cover — guarded above
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "error": {
                    "code": "unsupported_file_type",
                    "message": f"unsupported extension: {err.ext!r}",
                }
            },
        ) from err

    if name:
        extraction = ExtractionResult(
            name=name,
            extracted=extraction.extracted,
            extracted_chars=extraction.extracted_chars,
        )

    return await _persist(
        draft_id_str=draft_id,
        draft_uuid=draft_uuid,
        kind="file",
        extraction=extraction,
        original_bytes=raw,
        original_ext=ext,
        original_filename=filename,
    )


# ---------- DELETE /references/{ref_id} ----------


@router.delete(
    "/{draft_id}/references/{ref_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_reference(
    draft_id: str,
    ref_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    draft_uuid = await _resolve_draft(request, draft_id, current)

    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                select(ReferenceRow).where(
                    ReferenceRow.id == ref_id,
                    ReferenceRow.draft_id == draft_uuid,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise _not_found("reference_not_found")
        await session.delete(row)
        await session.commit()

    # Prefix-delete catches both originals/{ref_id}{ext} and
    # extracted/{ref_id}.md regardless of which extension we wrote.
    # The trailing `/` boundary in the parent path makes sibling refs
    # ("ref-aaaaaa") immune to deletion when their ids share a prefix.
    s3 = get_s3_client()
    try:
        await asyncio.gather(
            s3.delete_prefix(f"drafts/{draft_id}/references/originals/{ref_id}"),
            s3.delete_prefix(f"drafts/{draft_id}/references/extracted/{ref_id}"),
        )
    except S3Error:
        # DB row is already gone; an orphaned object will be skipped at
        # composition time per spec §"Error handling" (stale reference).
        pass

    return Response(status_code=status.HTTP_204_NO_CONTENT)
