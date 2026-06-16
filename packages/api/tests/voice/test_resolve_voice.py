"""Tests for blogforge.voice.resolve.resolve_voice.

Two code paths:
  • use_voice_profile=True  → materialize the user's voice profile from S3
  • use_voice_profile=False → return the named pack's root_path (legacy)
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from uuid import uuid4

import pytest
import pytest_asyncio

from blogforge.config import get_settings
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.s3 import get_s3_client, reset_s3_client_for_tests
from blogforge.s3.lifespan import ensure_bucket
from blogforge.voice.resolve import resolve_voice
from blogforge.voice.store import SqlVoiceStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_draft(*, use_voice_profile: bool, pack_slug: str = "dan") -> object:
    """Return a minimal draft-like object with idea.use_voice_profile + idea.pack_slug."""
    idea = SimpleNamespace(use_voice_profile=use_voice_profile, pack_slug=pack_slug)
    return SimpleNamespace(idea=idea)


def _make_pack_store(root: Path) -> object:
    """Return a stub pack_store whose .get(slug).root_path == root."""
    pack_info = SimpleNamespace(root_path=root)
    return SimpleNamespace(get=lambda slug: pack_info)


# ---------------------------------------------------------------------------
# S3 fixture — same pattern as test_voice_ingest.py
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


async def _seed_user() -> object:
    """Insert an approved user row; return the id."""
    async with get_sessionmaker()() as session:
        user = User(
            email=f"resolve-{uuid4().hex[:8]}@test.com",
            password_hash="x",
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


# ---------------------------------------------------------------------------
# Voice-profile path
# ---------------------------------------------------------------------------


async def test_resolve_voice_profile_path_returns_dir_with_stylepack_yaml(
    tmp_path: Path,
    s3_env: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """use_voice_profile=True: materialise a pack and return a dir with stylepack.yaml."""
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path / "cache"))

    user_id = await _seed_user()

    # Add one exemplar sample with text stored in S3.
    store = SqlVoiceStore()
    sample_text = "This is my writing sample for the voice profile."
    s3 = get_s3_client()
    s3_key = f"voice/test-sample-{uuid4().hex}.md"
    await s3.put_object(s3_key, sample_text.encode("utf-8"))

    await store.add_sample(
        user_id,
        kind="text",
        name="Sample A",
        s3_key=s3_key,
        extracted_chars=len(sample_text),
        exemplar=True,
        status="ready",
    )

    draft = _make_draft(use_voice_profile=True)
    # pack_store is irrelevant for the profile path, but we still pass it.
    pack_store = _make_pack_store(tmp_path / "nonexistent-pack")

    pack_root = await resolve_voice(draft, user_id, pack_store=pack_store)

    assert isinstance(pack_root, Path)
    assert (pack_root / "stylepack.yaml").is_file(), (
        f"Expected stylepack.yaml in {pack_root}"
    )


# ---------------------------------------------------------------------------
# Pack path (legacy)
# ---------------------------------------------------------------------------


async def test_resolve_voice_pack_path_returns_pack_root(tmp_path: Path) -> None:
    """use_voice_profile=False: return the named pack's root_path directly."""
    dan_root = tmp_path / "packs" / "dan"
    dan_root.mkdir(parents=True)
    pack_store = _make_pack_store(dan_root)

    draft = _make_draft(use_voice_profile=False, pack_slug="dan")
    # user_id is irrelevant for this branch but resolve_voice still accepts it.
    user_id = uuid4()

    pack_root = await resolve_voice(draft, user_id, pack_store=pack_store)

    assert pack_root == dan_root
