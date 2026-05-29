"""POST /api/drafts/{id}/stage — rework navigation (go back to research)."""
from __future__ import annotations


def _idea() -> dict[str, object]:
    return {"topic": "T", "pack_slug": "dan", "provider": "anthropic", "model": "m"}


def _advance_to_sections(client) -> str:
    created = client.post("/api/drafts", json=_idea()).json()
    created["outline"] = {
        "opening_hook": "Hook.",
        "sections": [{"id": "s1", "title": "First", "brief": ""}],
        "estimated_words": 0,
    }
    created["sections"] = [
        {
            "id": "s1", "title": "First", "brief": "",
            "content_md": "Written prose.", "status": "ready", "word_count": 2,
        },
    ]
    created["stage"] = "sections"
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]


async def test_reopen_research_preserves_work(authed_client) -> None:
    client, _ = authed_client
    did = _advance_to_sections(client)

    r = client.post(f"/api/drafts/{did}/stage", json={"stage": "research"})
    assert r.status_code == 200
    body = r.json()
    assert body["stage"] == "research"
    # Outline + section prose survive the trip back.
    assert body["outline"] is not None
    assert body["sections"][0]["content_md"] == "Written prose."


async def test_can_jump_forward_again_after_reopening(authed_client) -> None:
    client, _ = authed_client
    did = _advance_to_sections(client)
    client.post(f"/api/drafts/{did}/stage", json={"stage": "research"})
    # Forward to sections is allowed because sections exist.
    r = client.post(f"/api/drafts/{did}/stage", json={"stage": "sections"})
    assert r.status_code == 200
    assert r.json()["stage"] == "sections"


async def test_cannot_advance_to_sections_without_any(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]  # research, no sections
    r = client.post(f"/api/drafts/{did}/stage", json={"stage": "sections"})
    assert r.status_code == 409
    assert r.json()["detail"]["error"]["code"] == "invalid_stage"


async def test_cannot_advance_to_outline_without_one(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]
    r = client.post(f"/api/drafts/{did}/stage", json={"stage": "outline"})
    assert r.status_code == 409


async def test_stage_unknown_draft_404(authed_client) -> None:
    from uuid import uuid4

    client, _ = authed_client
    assert (
        client.post(f"/api/drafts/{uuid4()}/stage", json={"stage": "research"}).status_code == 404
    )


async def test_stage_invalid_value_422(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]
    assert client.post(f"/api/drafts/{did}/stage", json={"stage": "bogus"}).status_code == 422
