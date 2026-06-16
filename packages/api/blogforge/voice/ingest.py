"""Voice sample ingestion: store extracted markdown in S3 and record via SqlVoiceStore.

Three public coroutines cover the three ingest kinds:

    add_text_sample  — verbatim pasted text
    add_url_sample   — fetch + extract via trafilatura (references extractor)
    add_file_sample  — extract from raw file bytes (references extractor)

Extraction failures never raise: the sample is recorded with status="failed"
and extracted_chars=0 so the UI can show the row and allow the user to retry.

Reuses (never re-implements):
    blogforge.references.extractors.extract_text   — identity extractor for text
    blogforge.references.extractors.extract_url    — trafilatura URL fetch+extract
    blogforge.references.extractors.extract_file   — .txt / .md / .pdf extractor
    blogforge.references.extractors.UnsupportedFileType

S3 key layout:
    voice/{profile_id}/samples/{sample_id}.md
"""
from __future__ import annotations

from uuid import UUID, uuid4

from blogforge.references.extractors import (
    extract_file,
    extract_text,
    extract_url,
)
from blogforge.s3 import get_s3_client
from blogforge.voice.models import VoiceSample
from blogforge.voice.store import SqlVoiceStore


def _s3_key(profile_id: str, sample_id: str) -> str:
    """Build the canonical S3 key for a voice writing sample."""
    return f"voice/{profile_id}/samples/{sample_id}.md"


async def add_text_sample(
    user_id: UUID,
    *,
    name: str,
    text: str,
) -> VoiceSample:
    """Ingest pasted text verbatim as a voice writing sample.

    The text is stored as-is (identity extraction, same as the references
    text path via ``extract_text``).  Returns a ``VoiceSample`` with
    ``status="ready"``.
    """
    store = SqlVoiceStore()
    profile = await store.get_or_create(user_id)

    extraction = extract_text(name, text)
    sample_id = uuid4().hex
    s3_key = _s3_key(profile.id, sample_id)

    await get_s3_client().put_object(s3_key, extraction.extracted.encode("utf-8"), "text/markdown")

    return await store.add_sample(
        user_id,
        kind="text",
        name=extraction.name,
        s3_key=s3_key,
        extracted_chars=extraction.extracted_chars,
        status="ready",
    )


async def add_url_sample(
    user_id: UUID,
    *,
    url: str,
) -> VoiceSample:
    """Fetch a URL, extract its main content via trafilatura, and ingest.

    Uses ``extract_url`` from ``blogforge.references.extractors`` — the same
    function the references API route uses — so trafilatura is not
    reimplemented here.

    On fetch / extraction failure (``ValueError`` raised by ``extract_url``),
    the sample is recorded with ``status="failed"`` and ``extracted_chars=0``.
    The row is still created so the UI can display it and offer a retry.
    """
    store = SqlVoiceStore()
    profile = await store.get_or_create(user_id)
    sample_id = uuid4().hex
    s3_key = _s3_key(profile.id, sample_id)

    try:
        extraction = await extract_url(url)
    except Exception:  # any fetch/extract failure → record as failed, never raise
        return await store.add_sample(
            user_id,
            kind="url",
            name=url,
            s3_key=s3_key,
            extracted_chars=0,
            source_url=url,
            status="failed",
        )

    await get_s3_client().put_object(s3_key, extraction.extracted.encode("utf-8"), "text/markdown")

    return await store.add_sample(
        user_id,
        kind="url",
        name=extraction.name,
        s3_key=s3_key,
        extracted_chars=extraction.extracted_chars,
        source_url=url,
        status="ready",
    )


async def add_file_sample(
    user_id: UUID,
    *,
    filename: str,
    data: bytes,
) -> VoiceSample:
    """Extract text from raw file bytes and ingest as a voice writing sample.

    Uses ``extract_file`` from ``blogforge.references.extractors`` — the same
    function the references file-upload route uses.  Supported extensions are
    ``.md``, ``.txt``, and ``.pdf``.

    On unsupported extension (``UnsupportedFileType``) or any other extraction
    failure, the sample is recorded with ``status="failed"`` and
    ``extracted_chars=0`` — the row is still created for the UI.
    """
    store = SqlVoiceStore()
    profile = await store.get_or_create(user_id)
    sample_id = uuid4().hex
    s3_key = _s3_key(profile.id, sample_id)

    try:
        extraction = extract_file(filename, data)
    except Exception:  # unsupported type / any extract failure → record as failed
        return await store.add_sample(
            user_id,
            kind="file",
            name=filename,
            s3_key=s3_key,
            extracted_chars=0,
            original_filename=filename,
            status="failed",
        )

    await get_s3_client().put_object(s3_key, extraction.extracted.encode("utf-8"), "text/markdown")

    return await store.add_sample(
        user_id,
        kind="file",
        name=extraction.name,
        s3_key=s3_key,
        extracted_chars=extraction.extracted_chars,
        original_filename=filename,
        status="ready",
    )
