"""Tests for voice sample ingestion (text / url / file paths).

S3 fixture: reuses the same ThreadedMotoServer + aiobotocore pattern used by
test_s3_client.py and the references API tests.  Only the text path (no
network) is tested here; the url path would require real network or a more
involved mock.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest import mock
from uuid import uuid4

import pytest_asyncio

from blogforge.config import get_settings
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.s3 import get_s3_client, reset_s3_client_for_tests
from blogforge.s3.lifespan import ensure_bucket
from blogforge.voice.ingest import add_file_sample, add_text_sample
from blogforge.voice.models import VoiceSample


# ---------------------------------------------------------------------------
# S3 fixture — same pattern as test_s3_client.py / test_references_text.py
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def s3_env() -> AsyncIterator[None]:
    """Spin up moto's HTTP server and point the app's S3 client at it."""
    from moto.server import ThreadedMotoServer

    server = ThreadedMotoServer(port=0)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"
    env = {
        "BLOGFORGE_S3_ENDPOINT_URL": endpoint,
        "BLOGFORGE_S3_ACCESS_KEY": "test",
        "BLOGFORGE_S3_SECRET_KEY": "test",
        "BLOGFORGE_S3_BUCKET": "blogforge-test",
        "BLOGFORGE_S3_REGION": "us-east-1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        get_settings.cache_clear()
        reset_s3_client_for_tests()
        await ensure_bucket()
        try:
            yield
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_user(email: str) -> object:
    """Insert an approved user, return its id."""
    async with get_sessionmaker()() as session:
        user = User(
            email=email,
            password_hash="x",
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


# ---------------------------------------------------------------------------
# Text path
# ---------------------------------------------------------------------------


async def test_add_text_sample_returns_ready_sample(s3_env: None) -> None:
    """add_text_sample: status=='ready', extracted_chars==len(text), s3 key round-trips."""
    uid = await _seed_user("voice-text@test.com")
    text = "This is a writing sample. It has multiple sentences."

    sample = await add_text_sample(uid, name="My Essay", text=text)

    assert isinstance(sample, VoiceSample)
    assert sample.status == "ready"
    assert sample.kind == "text"
    assert sample.name == "My Essay"
    assert sample.extracted_chars == len(text)
    assert sample.s3_key.startswith("voice/")
    assert sample.s3_key.endswith(".md")

    # Round-trip through S3
    s3 = get_s3_client()
    stored_bytes = await s3.get_object(sample.s3_key)
    assert stored_bytes == text.encode("utf-8")


async def test_add_text_sample_s3_key_contains_profile_id(s3_env: None) -> None:
    """S3 key must be voice/{profile_id}/samples/{sample_id}.md."""
    from blogforge.voice.store import SqlVoiceStore

    uid = await _seed_user("voice-text-key@test.com")
    text = "Some content."

    sample = await add_text_sample(uid, name="Key Check", text=text)

    profile = await SqlVoiceStore().get_or_create(uid)
    # key format: voice/{profile_id}/samples/{sample_id}.md
    assert f"voice/{profile.id}/samples/" in sample.s3_key
    assert sample.s3_key.endswith(".md")


# ---------------------------------------------------------------------------
# File path (uses the real extract_file — no network needed)
# ---------------------------------------------------------------------------


async def test_add_file_sample_plain_text(s3_env: None) -> None:
    """add_file_sample with a .txt file: ready, chars match, content in S3."""
    uid = await _seed_user("voice-file@test.com")
    content = "Writing sample in a text file."
    data = content.encode("utf-8")

    sample = await add_file_sample(uid, filename="essay.txt", data=data)

    assert sample.status == "ready"
    assert sample.kind == "file"
    assert sample.original_filename == "essay.txt"
    assert sample.extracted_chars == len(content)

    s3 = get_s3_client()
    stored = await s3.get_object(sample.s3_key)
    assert stored.decode("utf-8") == content


async def test_add_file_sample_unsupported_extension_records_failed(s3_env: None) -> None:
    """Unsupported file types produce a 'failed' sample row, not an exception."""
    uid = await _seed_user("voice-file-fail@test.com")
    data = b"\x89PNG..."

    sample = await add_file_sample(uid, filename="photo.png", data=data)

    assert sample.status == "failed"
    assert sample.extracted_chars == 0
    # A DB row still exists so the UI can show + retry it
    assert sample.id


# ---------------------------------------------------------------------------
# URL path (mocked — no real network)
# ---------------------------------------------------------------------------


async def test_add_url_sample_mocked(s3_env: None) -> None:
    """add_url_sample with a mocked extractor: ready, source_url set, content in S3."""
    from unittest.mock import AsyncMock, patch

    from blogforge.references.extractors import ExtractionResult

    uid = await _seed_user("voice-url@test.com")
    url = "https://example.com/article"
    fake_md = "# Article\n\nThis is the article body."
    fake_result = ExtractionResult(name="Article", extracted=fake_md, extracted_chars=len(fake_md))

    with patch(
        "blogforge.voice.ingest.extract_url",
        new=AsyncMock(return_value=fake_result),
    ):
        from blogforge.voice.ingest import add_url_sample

        sample = await add_url_sample(uid, url=url)

    assert sample.status == "ready"
    assert sample.kind == "url"
    assert sample.source_url == url
    assert sample.name == "Article"
    assert sample.extracted_chars == len(fake_md)

    s3 = get_s3_client()
    stored = await s3.get_object(sample.s3_key)
    assert stored == fake_md.encode("utf-8")


async def test_add_url_sample_failed_extraction_records_failed(s3_env: None) -> None:
    """If extract_url raises ValueError, the sample is recorded as 'failed'."""
    from unittest.mock import AsyncMock, patch

    uid = await _seed_user("voice-url-fail@test.com")
    url = "https://bad-host.invalid/page"

    with patch(
        "blogforge.voice.ingest.extract_url",
        new=AsyncMock(side_effect=ValueError("failed to fetch")),
    ):
        from blogforge.voice.ingest import add_url_sample

        sample = await add_url_sample(uid, url=url)

    assert sample.status == "failed"
    assert sample.extracted_chars == 0
    assert sample.source_url == url
    assert sample.id
