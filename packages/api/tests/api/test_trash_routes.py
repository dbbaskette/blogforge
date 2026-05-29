"""Trash lifecycle: delete -> appears in /trash -> restore / hard-delete."""


def _idea_json() -> dict:
    return {
        "topic": "Trash me",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-x",
        "target_words": 800,
    }


async def test_delete_moves_to_trash_then_restore(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea_json()).json()["id"]

    # Soft delete -> gone from the main list, present in /trash.
    assert client.delete(f"/api/drafts/{did}").status_code == 204
    assert did not in [d["id"] for d in client.get("/api/drafts").json()]
    trashed = client.get("/api/drafts/trash").json()
    assert did in [d["id"] for d in trashed]

    # Restore -> back in the main list, gone from trash.
    r = client.post(f"/api/drafts/{did}/restore")
    assert r.status_code == 200
    assert r.json()["id"] == did
    assert did in [d["id"] for d in client.get("/api/drafts").json()]
    assert did not in [d["id"] for d in client.get("/api/drafts/trash").json()]


async def test_hard_delete_purges_a_trashed_draft(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea_json()).json()["id"]
    client.delete(f"/api/drafts/{did}")  # to trash

    # Hard delete only works on trashed drafts.
    assert client.delete(f"/api/drafts/{did}?hard=true").status_code == 204
    assert did not in [d["id"] for d in client.get("/api/drafts/trash").json()]
    # Gone for good — restore now 404s.
    assert client.post(f"/api/drafts/{did}/restore").status_code == 404


async def test_restore_unknown_404(authed_client) -> None:
    client, _ = authed_client
    from uuid import uuid4

    assert client.post(f"/api/drafts/{uuid4()}/restore").status_code == 404


async def test_hard_delete_live_draft_404s(authed_client) -> None:
    """hard=true on a non-trashed draft is a no-op 404 (use soft delete first)."""
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea_json()).json()["id"]
    assert client.delete(f"/api/drafts/{did}?hard=true").status_code == 404
    # Still alive.
    assert did in [d["id"] for d in client.get("/api/drafts").json()]
