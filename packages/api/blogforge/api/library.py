"""Reference library — reuse references across drafts.

Routes (all `get_current_user`-gated, all user-scoped):

  GET    /api/library/references
  POST   /api/library/references/from-draft/{draft_id}/{ref_id}   (promote)
  DELETE /api/library/references/{lib_id}
  POST   /api/drafts/{draft_id}/references/from-library/{lib_id}   (reuse)

"Promote" copies a draft reference's S3 objects into the user's library
prefix; "reuse" copies a library reference's objects back under a draft
prefix and inserts a normal `references` row, so prompt assembly, listing,
and deletion all work unchanged.
"""
from __future__ import annotations

import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select

from blogforge.api.references import _extracted_key, _originals_key, _ref_id
from blogforge.auth.dependencies import get_current_user
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import LibraryReference as LibraryRow
from blogforge.db.models import Reference as ReferenceRow
from blogforge.db.models import User
from blogforge.drafts.models import Reference
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.library.keys import lib_extracted_key, lib_original_key, lib_prefix
from blogforge.library.models import LibraryReference
from blogforge.references.extractors import file_extension_for_kind
from blogforge.s3 import S3Client, S3Error, get_s3_client

router = APIRouter(tags=["library"])

_EXTRACTED_CT = "text/markdown; charset=utf-8"
_ORIGINAL_CT = "application/octet-stream"


def _lib_id() -> str:
    return f"lib-{secrets.token_hex(6)}"


def _not_found(code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": {"code": code, "message": code}},
    )


def _lib_from_row(row: LibraryRow) -> LibraryReference:
    return LibraryReference(
        id=row.id,
        kind=row.kind,  # type: ignore[arg-type]
        name=row.name,
        url=row.url,
        original_filename=row.original_filename,
        extracted_chars=row.extracted_chars,
        added_at=row.added_at,
    )


async def _copy(s3: S3Client, src: str, dst: str, content_type: str) -> None:
    """Copy one S3 object (get + put). Raises S3Error on failure."""
    data = await s3.get_object(src)
    await s3.put_object(dst, data, content_type)


async def _resolve_draft(request: Request, draft_id: str, current: User) -> UUID:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _not_found("draft_not_found")
    return UUID(draft.id)


@router.get("/api/library/references")
async def list_library(
    request: Request,
    current: User = Depends(get_current_user),
) -> list[LibraryReference]:
    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                select(LibraryRow)
                .where(LibraryRow.user_id == current.id)
                .order_by(LibraryRow.added_at.desc())
            )
        ).scalars().all()
        return [_lib_from_row(r) for r in rows]


@router.post(
    "/api/library/references/from-draft/{draft_id}/{ref_id}",
    status_code=status.HTTP_201_CREATED,
)
async def promote_to_library(
    draft_id: str,
    ref_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> LibraryReference:
    draft_uuid = await _resolve_draft(request, draft_id, current)

    async with get_sessionmaker()() as session:
        ref = (
            await session.execute(
                select(ReferenceRow).where(
                    ReferenceRow.id == ref_id, ReferenceRow.draft_id == draft_uuid
                )
            )
        ).scalar_one_or_none()
        if ref is None:
            raise _not_found("reference_not_found")
        kind, name, url, original_filename, extracted_chars = (
            ref.kind,
            ref.name,
            ref.url,
            ref.original_filename,
            ref.extracted_chars,
        )

    ext = file_extension_for_kind(kind, original_filename)
    lib_id = _lib_id()
    s3 = get_s3_client()
    try:
        await _copy(
            s3,
            _extracted_key(draft_id, ref_id),
            lib_extracted_key(current.id, lib_id),
            _EXTRACTED_CT,
        )
        await _copy(
            s3,
            _originals_key(draft_id, ref_id, ext),
            lib_original_key(current.id, lib_id, ext),
            _ORIGINAL_CT,
        )
    except S3Error as err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": {"code": "storage_error", "message": str(err)}},
        ) from err

    async with get_sessionmaker()() as session:
        row = LibraryRow(
            id=lib_id,
            user_id=current.id,
            kind=kind,
            name=name,
            url=url,
            original_filename=original_filename,
            original_ext=ext,
            extracted_chars=extracted_chars,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return _lib_from_row(row)


@router.delete(
    "/api/library/references/{lib_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_library_reference(
    lib_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                select(LibraryRow).where(
                    LibraryRow.id == lib_id, LibraryRow.user_id == current.id
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise _not_found("library_reference_not_found")
        await session.delete(row)
        await session.commit()

    try:
        await get_s3_client().delete_prefix(lib_prefix(current.id, lib_id))
    except S3Error:
        pass  # DB row gone; orphaned objects are harmless
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/drafts/{draft_id}/references/from-library/{lib_id}",
    status_code=status.HTTP_201_CREATED,
)
async def add_from_library(
    draft_id: str,
    lib_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Reference:
    draft_uuid = await _resolve_draft(request, draft_id, current)

    async with get_sessionmaker()() as session:
        lib = (
            await session.execute(
                select(LibraryRow).where(
                    LibraryRow.id == lib_id, LibraryRow.user_id == current.id
                )
            )
        ).scalar_one_or_none()
        if lib is None:
            raise _not_found("library_reference_not_found")
        kind, name, url, original_filename, original_ext, extracted_chars = (
            lib.kind,
            lib.name,
            lib.url,
            lib.original_filename,
            lib.original_ext,
            lib.extracted_chars,
        )

    new_ref_id = _ref_id()
    s3 = get_s3_client()
    try:
        await _copy(
            s3,
            lib_extracted_key(current.id, lib_id),
            _extracted_key(draft_id, new_ref_id),
            _EXTRACTED_CT,
        )
        await _copy(
            s3,
            lib_original_key(current.id, lib_id, original_ext),
            _originals_key(draft_id, new_ref_id, original_ext),
            _ORIGINAL_CT,
        )
    except S3Error as err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": {"code": "storage_error", "message": str(err)}},
        ) from err

    async with get_sessionmaker()() as session:
        row = ReferenceRow(
            id=new_ref_id,
            draft_id=draft_uuid,
            kind=kind,
            name=name,
            url=url,
            original_filename=original_filename,
            extracted_chars=extracted_chars,
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
