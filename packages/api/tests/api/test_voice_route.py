"""Tests for the /api/voice REST endpoints (Task 8)."""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest import mock

import pytest
import pytest_asyncio

from blogforge.config import get_settings
from blogforge.s3 import reset_s3_client_for_tests
from blogforge.s3.lifespan import ensure_bucket
from tests.conftest import _seed_approved_user, _signed_client


# ---------------------------------------------------------------------------
# S3 fixture — moto-backed, same pattern as test_voice_ingest.py
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


@pytest_asyncio.fixture
async def voice_client(s3_env, monkeypatch: pytest.MonkeyPatch):
    """Authenticated TestClient signed in as a fresh approved user, with moto S3."""
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "## Style")
    uid = await _seed_approved_user()
    with _signed_client(uid) as c:
        yield c


# ---------------------------------------------------------------------------
# Basic profile retrieval and persona update
# ---------------------------------------------------------------------------


def test_get_creates_profile_and_persona_update(voice_client) -> None:
    r = voice_client.get("/api/voice")
    assert r.status_code == 200
    assert r.json()["name"] == "My Voice"

    r = voice_client.put(
        "/api/voice/persona",
        json={"identity": "B", "one_line": "o", "tone": "t"},
    )
    assert r.status_code == 200
    assert r.json()["persona_identity"] == "B"


# ---------------------------------------------------------------------------
# Text sample ingestion and distillation
# ---------------------------------------------------------------------------


def test_add_text_sample_and_distill(voice_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "## Style")

    voice_client.post(
        "/api/voice/samples/text", json={"name": "s", "text": "hello world"}
    )
    r = voice_client.post(
        "/api/voice/distill", json={"provider": "anthropic", "model": "m"}
    )
    assert r.status_code == 200
    assert "## Style" in r.json()["distilled_style_md"]


# ---------------------------------------------------------------------------
# Rules update
# ---------------------------------------------------------------------------


def test_update_rules(voice_client) -> None:
    r = voice_client.put(
        "/api/voice/rules",
        json={
            "banished_words": ["very"],
            "banished_phrases": [],
            "no_em_dashes": True,
            "no_ascii_double_hyphen": False,
        },
    )
    assert r.status_code == 200
    rules = r.json()["rules"]
    assert "very" in rules["banished_words"]
    assert rules["no_em_dashes"] is True


# ---------------------------------------------------------------------------
# Distilled style manual update
# ---------------------------------------------------------------------------


def test_update_distilled(voice_client) -> None:
    r = voice_client.put(
        "/api/voice/distilled",
        json={"distilled_style_md": "## My custom style"},
    )
    assert r.status_code == 200
    assert r.json()["distilled_style_md"] == "## My custom style"


# ---------------------------------------------------------------------------
# Sample deletion
# ---------------------------------------------------------------------------


def test_add_and_delete_sample(voice_client) -> None:
    r = voice_client.post(
        "/api/voice/samples/text", json={"name": "to_delete", "text": "bye"}
    )
    assert r.status_code == 201
    sample_id = r.json()["id"]

    # profile should contain the sample
    profile = voice_client.get("/api/voice").json()
    assert any(s["id"] == sample_id for s in profile["samples"])

    # delete it
    r = voice_client.delete(f"/api/voice/samples/{sample_id}")
    assert r.status_code == 204

    # profile should no longer contain the sample
    profile = voice_client.get("/api/voice").json()
    assert not any(s["id"] == sample_id for s in profile["samples"])


# ---------------------------------------------------------------------------
# Exemplar flag
# ---------------------------------------------------------------------------


def test_set_exemplar(voice_client) -> None:
    r = voice_client.post(
        "/api/voice/samples/text", json={"name": "exemplar_test", "text": "sample text"}
    )
    assert r.status_code == 201
    sample_id = r.json()["id"]

    r = voice_client.put(
        f"/api/voice/samples/{sample_id}/exemplar",
        json={"exemplar": True},
    )
    assert r.status_code == 200
    samples = {s["id"]: s for s in r.json()["samples"]}
    assert samples[sample_id]["exemplar"] is True


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def test_export_returns_zip(voice_client) -> None:
    r = voice_client.get("/api/voice/export")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    # ZIP magic bytes
    assert r.content[:2] == b"PK"
