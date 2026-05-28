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


# ---------- GET /references ----------


async def test_get_references_empty_for_new_draft(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    r = client.get(f"/api/drafts/{draft_id}/references")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_references_lists_in_added_order(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    html = "<html><head><title>T</title></head><body><p>x</p></body></html>"
    with (
        mock.patch(
            "pencraft.references.extractors.trafilatura.fetch_url", return_value=html
        ),
        mock.patch(
            "pencraft.references.extractors.trafilatura.extract", return_value="body"
        ),
    ):
        client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/a"},
        )
        client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/b"},
        )
    r = client.get(f"/api/drafts/{draft_id}/references")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    assert items[0]["added_at"] <= items[1]["added_at"]
    assert items[0]["url"] == "https://example.com/a"
    assert items[1]["url"] == "https://example.com/b"


async def test_get_references_unknown_draft_404(authed) -> None:
    client, _ = authed
    r = client.get("/api/drafts/00000000-0000-0000-0000-000000000000/references")
    assert r.status_code == 404


# ---------- DELETE /references/{ref_id} ----------


async def test_delete_reference_removes_row_and_s3_objects(authed) -> None:
    """Happy path: DB row gone + both S3 objects gone."""
    client, _ = authed
    draft_id = _create_draft(client)
    html = "<html><head><title>T</title></head><body><p>x</p></body></html>"
    with (
        mock.patch(
            "pencraft.references.extractors.trafilatura.fetch_url", return_value=html
        ),
        mock.patch(
            "pencraft.references.extractors.trafilatura.extract", return_value="body"
        ),
    ):
        created = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/doomed"},
        ).json()
    ref_id = created["id"]
    s3 = get_s3_client()
    # sanity
    assert await s3.head_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md"
    )
    assert await s3.head_object(
        f"drafts/{draft_id}/references/originals/{ref_id}.url-stub.txt"
    )

    r = client.delete(f"/api/drafts/{draft_id}/references/{ref_id}")
    assert r.status_code == 204

    # S3 objects gone
    assert not await s3.head_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md"
    )
    assert not await s3.head_object(
        f"drafts/{draft_id}/references/originals/{ref_id}.url-stub.txt"
    )


async def test_delete_unknown_reference_404(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    r = client.delete(f"/api/drafts/{draft_id}/references/ref-nope")
    assert r.status_code == 404


async def test_delete_unknown_draft_404(authed) -> None:
    client, _ = authed
    r = client.delete(
        "/api/drafts/00000000-0000-0000-0000-000000000000/references/ref-anything"
    )
    assert r.status_code == 404


async def test_delete_only_targets_specified_ref(authed) -> None:
    """Deleting one ref must NOT touch sibling refs in the same draft."""
    client, _ = authed
    draft_id = _create_draft(client)
    html = "<html><head><title>T</title></head><body><p>x</p></body></html>"
    with (
        mock.patch(
            "pencraft.references.extractors.trafilatura.fetch_url", return_value=html
        ),
        mock.patch(
            "pencraft.references.extractors.trafilatura.extract", return_value="body"
        ),
    ):
        a = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/a"},
        ).json()
        b = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/b"},
        ).json()
    assert client.delete(f"/api/drafts/{draft_id}/references/{a['id']}").status_code == 204
    s3 = get_s3_client()
    # `b` is untouched.
    assert await s3.head_object(
        f"drafts/{draft_id}/references/extracted/{b['id']}.md"
    )
    assert await s3.head_object(
        f"drafts/{draft_id}/references/originals/{b['id']}.url-stub.txt"
    )
