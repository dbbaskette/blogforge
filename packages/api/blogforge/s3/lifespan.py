"""Blob-storage lifecycle helpers — bucket/dir bootstrap at app startup."""

from __future__ import annotations

from blogforge.s3.client import get_s3_client


async def ensure_bucket() -> None:
    """Create the storage bucket (S3) or base dir (filesystem) if missing.

    Called from the FastAPI lifespan after migrations + before the server
    accepts requests. Idempotent for both backends.
    """
    await get_s3_client().bootstrap()
