"""PATCH /api/drafts/{id}/tags — draft labels for the list view."""
from __future__ import annotations


def _idea() -> dict[str, object]:
    return {"topic": "Taggable", "pack_slug": "dan", "provider": "anthropic", "model": "m"}


async def test_set_and_read_tags(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]
    # Fresh drafts start with no tags.
    assert client.get(f"/api/drafts/{did}").json()["tags"] == []

    r = client.patch(f"/api/drafts/{did}/tags", json={"tags": ["essay", "ai"]})
    assert r.status_code == 200
    assert r.json()["tags"] == ["essay", "ai"]

    # Surfaced in the list summary too.
    summary = next(d for d in client.get("/api/drafts").json() if d["id"] == did)
    assert summary["tags"] == ["essay", "ai"]


async def test_tags_are_normalized(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]
    r = client.patch(
        f"/api/drafts/{did}/tags",
        json={"tags": ["  Essay ", "essay", "", "AI", "ai"]},
    )
    # Trimmed, blanks dropped, deduped case-insensitively (first spelling wins).
    assert r.json()["tags"] == ["Essay", "AI"]


async def test_tags_survive_full_update(authed_client) -> None:
    """A subsequent PUT (auto-save) shouldn't silently wipe tags it round-trips."""
    client, _ = authed_client
    created = client.post("/api/drafts", json=_idea()).json()
    did = created["id"]
    client.patch(f"/api/drafts/{did}/tags", json={"tags": ["keep"]})

    full = client.get(f"/api/drafts/{did}").json()
    assert full["tags"] == ["keep"]
    full["title"] = "Renamed"
    client.put(f"/api/drafts/{did}", json=full)
    assert client.get(f"/api/drafts/{did}").json()["tags"] == ["keep"]


async def test_set_tags_unknown_draft_404(authed_client) -> None:
    from uuid import uuid4

    client, _ = authed_client
    assert client.patch(f"/api/drafts/{uuid4()}/tags", json={"tags": ["x"]}).status_code == 404
