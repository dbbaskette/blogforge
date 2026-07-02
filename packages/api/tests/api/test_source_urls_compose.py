"""Source URLs at compose-start: create_draft fetches them as grounding
references (reusing the fs blob backend + a mocked extractor — no network)."""

from __future__ import annotations

import pytest

from blogforge.references.extractors import ExtractionResult


@pytest.fixture
def fs_storage(tmp_path, monkeypatch):
    """Point the blob store at a tmp dir so _persist writes to disk, not S3."""
    from blogforge.config import get_settings
    from blogforge.s3.client import reset_s3_client_for_tests

    monkeypatch.setenv("BLOGFORGE_STORAGE_BACKEND", "fs")
    monkeypatch.setenv("BLOGFORGE_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    reset_s3_client_for_tests()
    yield
    get_settings.cache_clear()
    reset_s3_client_for_tests()


def _idea(**over) -> dict:  # type: ignore[type-arg]
    base = {
        "topic": "My CLI tool",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
    }
    base.update(over)
    return base


async def test_create_draft_ingests_source_urls(authed_client, fs_storage, monkeypatch) -> None:
    async def fake_extract(url: str) -> ExtractionResult:
        return ExtractionResult(name=f"T:{url}", extracted=f"# body {url}", extracted_chars=10)

    monkeypatch.setattr("blogforge.api.references.extract_url", fake_extract)
    client, _ = authed_client

    r = client.post(
        "/api/drafts",
        json=_idea(source_urls=["https://a.example", "https://b.example"]),
    )
    assert r.status_code == 201
    body = r.json()
    urls = sorted(ref["url"] for ref in body["references"] if ref["kind"] == "url")
    assert urls == ["https://a.example", "https://b.example"]
    assert body["reference_warnings"] == []


async def test_failed_url_is_nonfatal_and_warns(authed_client, fs_storage, monkeypatch) -> None:
    async def fake_extract(url: str) -> ExtractionResult:
        if "bad" in url:
            raise ValueError("could not fetch")
        return ExtractionResult(name="ok", extracted="# ok", extracted_chars=4)

    monkeypatch.setattr("blogforge.api.references.extract_url", fake_extract)
    client, _ = authed_client

    r = client.post(
        "/api/drafts",
        json=_idea(source_urls=["https://ok.example", "https://bad.example"]),
    )
    assert r.status_code == 201
    body = r.json()
    assert [ref["url"] for ref in body["references"] if ref["kind"] == "url"] == [
        "https://ok.example"
    ]
    warns = body["reference_warnings"]
    assert [w["url"] for w in warns] == ["https://bad.example"]
    assert "could not fetch" in warns[0]["error"]


async def test_too_many_urls_is_422(authed_client) -> None:
    client, _ = authed_client
    r = client.post(
        "/api/drafts",
        json=_idea(source_urls=[f"https://x{i}.example" for i in range(11)]),
    )
    assert r.status_code == 422
