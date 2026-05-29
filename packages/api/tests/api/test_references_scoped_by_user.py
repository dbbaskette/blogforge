"""Per-user scoping for the references API.

User A creates a draft + reference. User B's GET / POST / DELETE on
those resources must all 404 (never 403) so the existence of A's
draft can't be probed via this surface.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest import mock

import pytest_asyncio
from fastapi.testclient import TestClient
from moto.server import ThreadedMotoServer

from blogforge.auth.passwords import hash_password
from blogforge.auth.sessions import COOKIE_NAME, SessionSigner
from blogforge.config import get_settings
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.s3 import reset_s3_client_for_tests
from blogforge.s3.lifespan import ensure_bucket
from blogforge.server import create_app


@pytest_asyncio.fixture
async def s3_env() -> AsyncIterator[str]:
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
            yield endpoint
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


async def _seed_user(email: str):
    async with get_sessionmaker()() as session:
        u = User(
            email=email,
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(u)
        await session.commit()
        await session.refresh(u)
        return u.id


def _signed_client(uid) -> TestClient:
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
    return c


def _idea_json() -> dict:  # type: ignore[type-arg]
    return {
        "topic": "T",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "m",
        "target_words": 1200,
    }


def _add_url_ref(client: TestClient, draft_id: str) -> str:
    html = "<html><head><title>T</title></head><body><p>x</p></body></html>"
    with (
        mock.patch(
            "blogforge.references.extractors.trafilatura.fetch_url", return_value=html
        ),
        mock.patch(
            "blogforge.references.extractors.trafilatura.extract", return_value="body"
        ),
    ):
        r = client.post(
            f"/api/drafts/{draft_id}/references/url",
            json={"url": "https://example.com/a"},
        )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest_asyncio.fixture
async def two_authed_clients(s3_env: str):
    """Yield (client_a, client_b, a_draft_id, a_ref_id) — A owns; B is the
    interloper."""
    a_id = await _seed_user("alpha@user.com")
    b_id = await _seed_user("bravo@user.com")
    ca = _signed_client(a_id)
    cb = _signed_client(b_id)
    with ca, cb:
        draft_id = ca.post("/api/drafts", json=_idea_json()).json()["id"]
        ref_id = _add_url_ref(ca, draft_id)
        yield ca, cb, draft_id, ref_id


# ---------- GET ----------


async def test_b_cannot_list_a_references(two_authed_clients) -> None:
    _, cb, draft_id, _ = two_authed_clients
    r = cb.get(f"/api/drafts/{draft_id}/references")
    assert r.status_code == 404


# ---------- POST url / text / file ----------


async def test_b_cannot_post_url_on_a_draft(two_authed_clients) -> None:
    _, cb, draft_id, _ = two_authed_clients
    r = cb.post(
        f"/api/drafts/{draft_id}/references/url",
        json={"url": "https://evil.example.com"},
    )
    assert r.status_code == 404


async def test_b_cannot_post_text_on_a_draft(two_authed_clients) -> None:
    _, cb, draft_id, _ = two_authed_clients
    r = cb.post(
        f"/api/drafts/{draft_id}/references/text",
        json={"name": "x", "content": "leaked"},
    )
    assert r.status_code == 404


async def test_b_cannot_post_file_on_a_draft(two_authed_clients) -> None:
    _, cb, draft_id, _ = two_authed_clients
    r = cb.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("n.md", b"hi", "text/markdown")},
    )
    assert r.status_code == 404


# ---------- DELETE ----------


async def test_b_cannot_delete_a_reference(two_authed_clients) -> None:
    ca, cb, draft_id, ref_id = two_authed_clients
    r = cb.delete(f"/api/drafts/{draft_id}/references/{ref_id}")
    assert r.status_code == 404
    # A's reference still listable + still present in DB.
    items = ca.get(f"/api/drafts/{draft_id}/references").json()
    assert any(r["id"] == ref_id for r in items)
