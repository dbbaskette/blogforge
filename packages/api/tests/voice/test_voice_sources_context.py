"""Tests for build_background_context — formats ready sources, ignores failed, returns "" when none."""
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from blogforge.voice.models import VoiceSource
from blogforge.voice.sources_context import build_background_context, _HEADER


def _make_source(
    url: str = "https://example.com",
    name: str = "Example",
    s3_key: str = "voice/p/sources/abc.md",
    status: str = "ready",
    extracted_chars: int = 100,
) -> VoiceSource:
    return VoiceSource(
        id=uuid4().hex,
        url=url,
        name=name,
        s3_key=s3_key,
        extracted_chars=extracted_chars,
        status=status,
    )


async def test_returns_empty_when_no_sources() -> None:
    user_id = uuid4()
    with patch("blogforge.voice.sources_context.SqlVoiceStore") as MockStore:
        instance = MockStore.return_value
        instance.list_sources = AsyncMock(return_value=[])
        result = await build_background_context(user_id)
    assert result == ""


async def test_returns_empty_when_all_sources_failed() -> None:
    user_id = uuid4()
    sources = [_make_source(status="failed"), _make_source(status="failed")]
    with patch("blogforge.voice.sources_context.SqlVoiceStore") as MockStore:
        instance = MockStore.return_value
        instance.list_sources = AsyncMock(return_value=sources)
        result = await build_background_context(user_id)
    assert result == ""


async def test_formats_ready_sources() -> None:
    user_id = uuid4()
    s1 = _make_source(name="Tanzu Docs", url="https://tanzu.vmware.com", s3_key="k1")
    s2 = _make_source(name="Another Source", url="https://other.com", s3_key="k2")

    async def fake_get_object(key: str) -> bytes:
        if key == "k1":
            return b"Product info about Tanzu."
        return b"Other reference material."

    with (
        patch("blogforge.voice.sources_context.SqlVoiceStore") as MockStore,
        patch("blogforge.voice.sources_context.get_s3_client") as mock_s3,
    ):
        instance = MockStore.return_value
        instance.list_sources = AsyncMock(return_value=[s1, s2])
        mock_s3.return_value.get_object = AsyncMock(side_effect=fake_get_object)

        result = await build_background_context(user_id)

    assert result.startswith("## Background sources")
    assert "facts/terminology" in result
    assert "### Tanzu Docs" in result
    assert "Product info about Tanzu." in result
    assert "### Another Source" in result
    assert "Other reference material." in result


async def test_skips_failed_sources_in_mixed_list() -> None:
    user_id = uuid4()
    good = _make_source(name="Good", s3_key="good.md", status="ready")
    bad = _make_source(name="Bad", s3_key="bad.md", status="failed")

    async def fake_get_object(key: str) -> bytes:
        return b"Good content."

    with (
        patch("blogforge.voice.sources_context.SqlVoiceStore") as MockStore,
        patch("blogforge.voice.sources_context.get_s3_client") as mock_s3,
    ):
        instance = MockStore.return_value
        instance.list_sources = AsyncMock(return_value=[good, bad])
        mock_s3.return_value.get_object = AsyncMock(side_effect=fake_get_object)

        result = await build_background_context(user_id)

    assert "### Good" in result
    assert "### Bad" not in result


async def test_skips_source_on_s3_error_never_raises() -> None:
    user_id = uuid4()
    s1 = _make_source(name="Broken", s3_key="broken.md", status="ready")

    with (
        patch("blogforge.voice.sources_context.SqlVoiceStore") as MockStore,
        patch("blogforge.voice.sources_context.get_s3_client") as mock_s3,
    ):
        instance = MockStore.return_value
        instance.list_sources = AsyncMock(return_value=[s1])
        mock_s3.return_value.get_object = AsyncMock(side_effect=Exception("S3 down"))

        # Should not raise; returns "" since nothing could be loaded
        result = await build_background_context(user_id)

    assert result == ""


async def test_per_source_truncation() -> None:
    user_id = uuid4()
    s1 = _make_source(name="Long", s3_key="long.md", status="ready")
    long_content = "x" * 10_000  # well over per-source limit of 4000

    with (
        patch("blogforge.voice.sources_context.SqlVoiceStore") as MockStore,
        patch("blogforge.voice.sources_context.get_s3_client") as mock_s3,
    ):
        instance = MockStore.return_value
        instance.list_sources = AsyncMock(return_value=[s1])
        mock_s3.return_value.get_object = AsyncMock(return_value=long_content.encode())

        result = await build_background_context(user_id)

    # Content in result should be capped at _PER_SOURCE_LIMIT chars per source
    # The header/section header adds overhead, so just check result is not huge
    assert "x" * 4_001 not in result
    assert "### Long" in result
