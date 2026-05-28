"""POST/GET/DELETE /api/drafts/{id}/references — URL kind + listing + delete.

The URL extractor itself is unit-tested in test_extractors.py; here we
mock trafilatura to keep these tests deterministic and exercise the
route's S3 persistence + DB write end-to-end against an in-process moto
S3 server.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest import mock

import pytest_asyncio
from fastapi.testclient import TestClient
from moto.server import ThreadedMotoServer

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.config import get_settings
from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import User
from pencraft.s3 import get_s3_client, reset_s3_client_for_tests
from pencraft.s3.lifespan import ensure_bucket
from pencraft.server import create_app


@pytest_asyncio.fixture
async def s3_env() -> AsyncIterator[str]:
    """Spin up moto + point Settings at it + create the bucket."""
    server = ThreadedMotoServer(port=0)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"
    env = {
        "PENCRAFT_S3_ENDPOINT_URL": endpoint,
        "PENCRAFT_S3_ACCESS_KEY": "test",
        "PENCRAFT_S3_SECRET_KEY": "test",
        "PENCRAFT_S3_BUCKET": "pencraft-test",
        "PENCRAFT_S3_REGION": "us-east-1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        get_settings.cache_clear()
        reset_s3_client_for_tests()
        await ensure_bucket()
        try:
            yield endpoint
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


async def _seed_user(email: str = "ref-test@user.com"):
    async with get_sessionmaker()() as session:
        user = User(
            email=email,
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


def _signed_client(uid) -> TestClient:
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
    return c


@pytest_asyncio.fixture
async def authed(s3_env: str):
    uid = await _seed_user()
    c = _signed_client(uid)
    with c:
        yield c, uid


def _idea_json() -> dict:  # type: ignore[type-arg]
    return {
        "topic": "Test topic",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "target_words": 1200,
    }


def _create_draft(client: TestClient) -> str:
    return client.post("/api/drafts", json=_idea_json()).json()["id"]


# ---------- POST /references/url ----------


async def test_post_url_persists_reference_and_objects(authed) -> None:
    client, _uid = authed
    draft_id = _create_draft(client)

    html = "<html><head><title>Atlas Docs</title></head><body><p>x</p></body></html>"
    with (
        mock.patch(
            "pencraft.references.extractors.trafilatura.fetch_url", return_value=html
        ),
        mock.patch(
            "pencraft.references.extractors.trafilatura.extract",
            return_value="# Atlas Docs\n\nBody text.",
        ),
    ):
        r = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/docs"},
        )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "url"
    assert body["url"] == "https://example.com/docs"
    assert body["name"] == "Atlas Docs"
    assert body["extracted_chars"] > 0
    ref_id = body["id"]
    assert ref_id.startswith("ref-")

    # Both S3 objects landed.
    s3 = get_s3_client()
    assert await s3.head_object(
        f"drafts/{draft_id}/references/originals/{ref_id}.url-stub.txt"
    )
    assert await s3.head_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md"
    )
    extracted = (
        await s3.get_object(f"drafts/{draft_id}/references/extracted/{ref_id}.md")
    ).decode("utf-8")
    assert "Body text" in extracted


async def test_post_url_custom_name_overrides_title(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    html = "<html><head><title>Auto Title</title></head><body><p>x</p></body></html>"
    with (
        mock.patch(
            "pencraft.references.extractors.trafilatura.fetch_url", return_value=html
        ),
        mock.patch(
            "pencraft.references.extractors.trafilatura.extract", return_value="content"
        ),
    ):
        r = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/x", "name": "My label"},
        )
    assert r.status_code == 201
    assert r.json()["name"] == "My label"


async def test_post_url_fetch_failure_returns_422(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    with mock.patch(
        "pencraft.references.extractors.trafilatura.fetch_url", return_value=None
    ):
        r = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/dead"},
        )
    assert r.status_code == 422
    assert r.json()["detail"]["error"]["code"] == "url_fetch_failed"


async def test_post_url_unknown_draft_404(authed) -> None:
    client, _ = authed
    r = client.post(
        "/api/drafts/00000000-0000-0000-0000-000000000000/references/url",
        json={"url": "https://example.com"},
    )
    assert r.status_code == 404
