"""POST /api/drafts/{id}/references/file — multipart upload for md/txt/pdf."""
from __future__ import annotations

import io
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


async def _seed_user(email: str = "file-test@user.com"):
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


def _tiny_pdf_bytes() -> bytes:
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


# ---------- happy path: .md ----------


async def test_post_file_md_round_trips(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    payload = b"# Heading\n\nMarkdown body."
    r = client.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("notes.md", payload, "text/markdown")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "file"
    assert body["name"] == "notes.md"
    assert body["original_filename"] == "notes.md"
    assert body["extracted_chars"] > 0
    ref_id = body["id"]
    s3 = get_s3_client()
    raw = await s3.get_object(
        f"drafts/{draft_id}/references/originals/{ref_id}.md"
    )
    assert raw == payload
    extracted = await s3.get_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md"
    )
    assert b"Markdown body." in extracted


# ---------- .txt ----------


async def test_post_file_txt_round_trips(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    payload = b"plain text body"
    r = client.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("note.txt", payload, "text/plain")},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "note.txt"


# ---------- .pdf ----------


async def test_post_file_pdf_round_trips(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    raw = _tiny_pdf_bytes()
    r = client.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("blank.pdf", raw, "application/pdf")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "blank.pdf"
    assert body["original_filename"] == "blank.pdf"
    # Blank page extracts to empty, but the row+objects still land.
    ref_id = body["id"]
    s3 = get_s3_client()
    assert await s3.head_object(
        f"drafts/{draft_id}/references/originals/{ref_id}.pdf"
    )
    assert await s3.head_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md"
    )


# ---------- size + type validation ----------


async def test_post_file_too_large_413(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    huge = b"x" * (6 * 1024 * 1024)  # 6 MB
    r = client.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("big.txt", huge, "text/plain")},
    )
    assert r.status_code == 413
    assert r.json()["detail"]["error"]["code"] == "file_too_large"


async def test_post_file_unsupported_415(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    r = client.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("logo.png", b"\x89PNG\r\n", "image/png")},
    )
    assert r.status_code == 415
    assert r.json()["detail"]["error"]["code"] == "unsupported_file_type"


async def test_post_file_custom_name_override(authed) -> None:
    client, _ = authed
    draft_id = _create_draft(client)
    r = client.post(
        f"/api/drafts/{draft_id}/references/file",
        files={"file": ("auto.md", b"hi", "text/markdown")},
        data={"name": "My label"},
    )
    assert r.status_code == 201
    assert r.json()["name"] == "My label"


async def test_post_file_unknown_draft_404(authed) -> None:
    client, _ = authed
    r = client.post(
        "/api/drafts/00000000-0000-0000-0000-000000000000/references/file",
        files={"file": ("n.md", b"hi", "text/markdown")},
    )
    assert r.status_code == 404
