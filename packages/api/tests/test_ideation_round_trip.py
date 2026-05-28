"""POST /ideation/message → streaming job → message persisted; /accept; GET history."""
from __future__ import annotations

import asyncio
import json

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.drafts.models import IdeaInput
from pencraft.drafts.sql_store import SqlDraftStore
from pencraft.server import create_app


@pytest.fixture(autouse=True)
def _force_keys_into_env(monkeypatch):
    """KeyVault would otherwise hit ~/.myvoice/config.yaml; stub by writing
    a provider key via the test path."""
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", "/nonexistent.yaml")


@pytest_asyncio.fixture
async def signed_admin_client():
    """Create app, seed an approved admin, return (client, draft_id) with a draft pre-created."""
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with get_sessionmaker()() as session:
        user = User(
            email="ideation@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        user_id = user.id

    store = SqlDraftStore()
    idea = IdeaInput(
        topic="Bureaucracy in the wild",
        bullets=["a", "b"],
        pack_slug="dan",
        provider="anthropic",
        model="claude-test",
        target_words=1500,
    )
    draft = await store.create(user_id=user_id, idea=idea)

    app = create_app()
    client = TestClient(app)
    client.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(user_id))
    with client:
        yield client, draft.id


# ── stub the LLM so we never hit the network ────────────────────────


@pytest.fixture(autouse=True)
def _stub_llm(monkeypatch):
    """Replace stream_ideation with a canned generator that yields a few
    deltas + a result event with a parsed proposed_outline."""

    async def _fake_stream_ideation(*args, **kwargs):
        from pencraft.drafts.models import OutlineProposal, OutlineSection

        deltas = [
            "Here's an outline:\n\n",
            "```json\n",
            json.dumps({
                "opening_hook": "h",
                "sections": [{"id": "01", "title": "T", "brief": "b"}],
                "estimated_words": 800,
            }),
            "\n```\n",
        ]
        for d in deltas:
            yield {"kind": "delta", "delta": d}
        proposal = OutlineProposal(
            opening_hook="h",
            sections=[OutlineSection(id="01", title="T", brief="b")],
            estimated_words=800,
        )
        yield {"kind": "result", "text": "".join(deltas), "proposed_outline": proposal}

    # Also stub KeyVault so it doesn't 400.
    async def _fake_get_key(self, provider: str) -> str:
        return "sk-stub"

    monkeypatch.setattr(
        "pencraft.api.ideation.stream_ideation", _fake_stream_ideation
    )
    monkeypatch.setattr(
        "pencraft.keys.vault.KeyVault.get", _fake_get_key
    )


# ── tests ───────────────────────────────────────────────────────────


async def test_post_message_returns_job_id_and_persists_messages(signed_admin_client):
    client, draft_id = signed_admin_client

    r = client.post(
        f"/api/drafts/{draft_id}/ideation/message",
        json={"content": "propose an outline please"},
    )
    assert r.status_code == 202, f"expected 202, got {r.status_code}: {r.text}"
    job_id = r.json()["job_id"]
    assert job_id

    # Wait until the background task finishes by polling the job endpoint.
    for _ in range(50):
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("succeeded", "failed", "cancelled"):
            break
        await asyncio.sleep(0.05)
    else:
        pytest.fail("job didn't terminate in time")
    assert j["status"] == "succeeded"

    # Both messages persisted.
    history = client.get(f"/api/drafts/{draft_id}/ideation").json()
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[0]["content"] == "propose an outline please"
    assert history[1]["role"] == "assistant"
    assert history[1]["proposed_outline"] is not None
    assert history[1]["proposed_outline"]["opening_hook"] == "h"


async def test_accept_copies_outline_and_advances_stage(signed_admin_client):
    client, draft_id = signed_admin_client

    # Send a message, wait for completion.
    r = client.post(
        f"/api/drafts/{draft_id}/ideation/message", json={"content": "go"}
    )
    job_id = r.json()["job_id"]
    for _ in range(50):
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("succeeded", "failed", "cancelled"):
            break
        await asyncio.sleep(0.05)
    assert j["status"] == "succeeded"

    # Accept.
    r = client.post(f"/api/drafts/{draft_id}/ideation/accept")
    assert r.status_code == 200
    body = r.json()
    assert body["stage"] == "outline"
    assert body["outline"] is not None
    assert body["outline"]["opening_hook"] == "h"

    # Sections must be seeded from the outline so /expand doesn't 409 the
    # moment the user clicks Compose.
    assert len(body["sections"]) == len(body["outline"]["sections"])
    assert body["sections"][0]["id"] == body["outline"]["sections"][0]["id"]
    assert body["sections"][0]["title"] == body["outline"]["sections"][0]["title"]
    assert body["sections"][0]["status"] == "empty"


async def test_accept_returns_409_when_no_proposed_outline_yet(signed_admin_client):
    client, draft_id = signed_admin_client
    r = client.post(f"/api/drafts/{draft_id}/ideation/accept")
    assert r.status_code == 409
    assert "no_proposed_outline" in r.text


async def test_in_flight_lock_blocks_second_claim():
    """Direct unit test of the _try_claim/_release helpers.

    A full-integration test that holds the BG task open while polling
    via TestClient won't work — sync TestClient blocks until background
    tasks finish — so we test the lock contract directly. The route
    handler calls _try_claim before adding the BG task and the BG task
    calls _release in its finally; together that's the 409 we promise
    when an ideation is in flight."""
    from pencraft.api.ideation import _release, _try_claim

    assert await _try_claim("d-test") is True
    assert await _try_claim("d-test") is False
    await _release("d-test")
    assert await _try_claim("d-test") is True
    await _release("d-test")


async def test_history_endpoint_returns_ordered_list(signed_admin_client):
    client, draft_id = signed_admin_client
    # Empty initially.
    r = client.get(f"/api/drafts/{draft_id}/ideation")
    assert r.status_code == 200
    assert r.json() == []


async def test_cross_user_404(signed_admin_client):
    """Another user's draft 404s on all three endpoints."""
    client, _ = signed_admin_client

    # Bake a second user + draft.
    async with get_sessionmaker()() as session:
        other = User(
            email="other@x.com",
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(other)
        await session.commit()
        await session.refresh(other)
        other_id = other.id

    store = SqlDraftStore()
    other_draft = await store.create(
        user_id=other_id,
        idea=IdeaInput(
            topic="x",
            pack_slug="dan",
            provider="anthropic",
            model="m",
            target_words=300,
        ),
    )

    # Our `client` (signed in as ideation@x.com) shouldn't see other's draft.
    assert (
        client.get(f"/api/drafts/{other_draft.id}/ideation").status_code == 404
    )
    assert (
        client.post(
            f"/api/drafts/{other_draft.id}/ideation/message", json={"content": "x"}
        ).status_code
        == 404
    )
    assert (
        client.post(f"/api/drafts/{other_draft.id}/ideation/accept").status_code == 404
    )
