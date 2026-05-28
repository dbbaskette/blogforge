"""POST /api/drafts/{id}/references/text — pasted-content reference."""
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


async def _seed_user(email: str = "text-test@user.com"):
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


async def test_post_text_round_trips(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    r = client.post(
        f"/api/drafts/{draft_id}/references/text",
        json={"name": "Background notes", "content": "Pencraft is fun."},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "text"
    assert body["name"] == "Background notes"
    assert body["url"] is None
    assert body["original_filename"] is None
    assert body["extracted_chars"] == len("Pencraft is fun.")

    ref_id = body["id"]
    s3 = get_s3_client()
    # Original is the raw paste as .txt
    raw = await s3.get_object(
        f"drafts/{draft_id}/references/originals/{ref_id}.txt"
    )
    assert raw.decode("utf-8") == "Pencraft is fun."
    extracted = await s3.get_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md"
    )
    assert extracted.decode("utf-8") == "Pencraft is fun."


async def test_post_text_empty_content_rejected(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    r = client.post(
        f"/api/drafts/{draft_id}/references/text",
        json={"name": "x", "content": ""},
    )
    # pydantic min_length=1 → 422 validation error
    assert r.status_code == 422


async def test_post_text_oversize_rejected(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    # 6 MB raw — over the 5 MB cap.
    huge = "a" * (6 * 1024 * 1024)
    r = client.post(
        f"/api/drafts/{draft_id}/references/text",
        json={"name": "huge", "content": huge},
    )
    assert r.status_code == 413
    assert r.json()["detail"]["error"]["code"] == "file_too_large"


async def test_post_text_unknown_draft_404(authed) -> None:
    client, _ = authed
    r = client.post(
        "/api/drafts/00000000-0000-0000-0000-000000000000/references/text",
        json={"name": "x", "content": "content"},
    )
    assert r.status_code == 404
