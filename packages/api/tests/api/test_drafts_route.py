"""CRUD route tests for /api/drafts."""
from __future__ import annotations


def _idea_json() -> dict:  # type: ignore[type-arg]
    return {
        "topic": "Test topic",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "target_words": 1200,
    }


async def test_create_draft(authed_client) -> None:
    client, _ = authed_client
    r = client.post("/api/drafts", json=_idea_json())
    assert r.status_code == 201
    body = r.json()
    assert body["idea"]["topic"] == "Test topic"
    assert body["stage"] == "research"


async def test_create_draft_persists_codex_cli_provider(authed_client) -> None:
    client, _ = authed_client
    idea = {**_idea_json(), "provider": "codex-cli", "model": "codex-default"}
    r = client.post("/api/drafts", json=idea)
    assert r.status_code == 201
    assert r.json()["idea"]["provider"] == "codex-cli"
    assert r.json()["idea"]["model"] == "codex-default"


async def test_import_keeps_the_opening_above_the_first_section(authed_client) -> None:
    """Prose before the first ## is the article's opening — it lands in
    outline.opening_hook (which exports above the sections), NOT folded under the
    first heading. This is the fidelity guarantee for imported posts."""
    client, _ = authed_client
    md = (
        "# Faster is Still Safer\n\n"
        "In January 2017, the team wrote a post.\n\n"
        "## ROTATE\n\n"
        "The 2017 baseline."
    )
    r = client.post(
        "/api/drafts/import",
        json={
            "text": md,
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["stage"] == "sections"
    assert body["outline"]["opening_hook"] == "In January 2017, the team wrote a post."
    assert [s["title"] for s in body["sections"]] == ["ROTATE"]
    # The first section holds only its own body — the opening isn't duplicated in.
    assert body["sections"][0]["content_md"] == "The 2017 baseline."


async def test_list_drafts(authed_client) -> None:
    client, _ = authed_client
    client.post("/api/drafts", json=_idea_json())
    client.post("/api/drafts", json=_idea_json())
    r = client.get("/api/drafts")
    assert r.status_code == 200
    summaries = r.json()
    assert len(summaries) == 2


async def test_get_draft(authed_client) -> None:
    client, _ = authed_client
    created = client.post("/api/drafts", json=_idea_json()).json()
    r = client.get(f"/api/drafts/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


async def test_get_unknown_404(authed_client) -> None:
    client, _ = authed_client
    r = client.get("/api/drafts/nope")
    assert r.status_code == 404


async def test_update_draft(authed_client) -> None:
    client, _ = authed_client
    created = client.post("/api/drafts", json=_idea_json()).json()
    created["title"] = "Updated title"
    r = client.put(f"/api/drafts/{created['id']}", json=created)
    assert r.status_code == 200
    assert r.json()["title"] == "Updated title"


async def test_update_draft_persists_codex_cli_provider(authed_client) -> None:
    client, _ = authed_client
    created = client.post("/api/drafts", json=_idea_json()).json()
    created["idea"]["provider"] = "codex-cli"
    created["idea"]["model"] = "codex-default"

    updated = client.put(f"/api/drafts/{created['id']}", json=created)
    assert updated.status_code == 200
    fetched = client.get(f"/api/drafts/{created['id']}")
    assert fetched.json()["idea"]["provider"] == "codex-cli"
    assert fetched.json()["idea"]["model"] == "codex-default"


async def test_delete_draft(authed_client) -> None:
    client, _ = authed_client
    created = client.post("/api/drafts", json=_idea_json()).json()
    r = client.delete(f"/api/drafts/{created['id']}")
    assert r.status_code == 204
    r2 = client.get(f"/api/drafts/{created['id']}")
    assert r2.status_code == 404


async def test_put_does_not_regress_stage_or_clobber_outline(authed_client) -> None:
    """Regression: a stale Stage 1 auto-save must not wipe a freshly-generated outline."""
    client, _ = authed_client
    created = client.post("/api/drafts", json=_idea_json()).json()
    promoted = dict(created)
    promoted["stage"] = "outline"
    promoted["outline"] = {
        "opening_hook": "An opener.",
        "sections": [{"id": "s1", "title": "First", "brief": "b1"}],
        "estimated_words": 800,
    }
    promoted["sections"] = [{
        "id": "s1", "title": "First", "brief": "b1",
        "content_md": "", "status": "empty",
        "last_generated_at": None, "word_count": 0,
    }]
    r = client.put(f"/api/drafts/{created['id']}", json=promoted)
    assert r.status_code == 200
    assert r.json()["stage"] == "outline"

    stale = dict(created)
    stale["stage"] = "research"
    stale["outline"] = None
    stale["sections"] = []
    r = client.put(f"/api/drafts/{created['id']}", json=stale)
    assert r.status_code == 200
    body = r.json()
    assert body["stage"] == "outline", "stage should not regress research ← outline"
    assert body["outline"] is not None, "outline must not be clobbered by stale PUT"
    assert len(body["sections"]) == 1, "sections must not be clobbered"


def _import_body(text: str) -> dict:  # type: ignore[type-arg]
    return {"text": text, "pack_slug": "dan", "provider": "anthropic", "model": "m"}


async def test_import_draft_splits_by_headings(authed_client) -> None:
    client, _ = authed_client
    r = client.post(
        "/api/drafts/import",
        json=_import_body("# My Post\n\n## Intro\n\nHello.\n\n## Body\n\nStuff."),
    )
    assert r.status_code == 201
    d = r.json()
    assert d["title"] == "My Post"
    assert d["stage"] == "sections"
    assert [s["title"] for s in d["sections"]] == ["Intro", "Body"]
    assert d["sections"][0]["content_md"] == "Hello."
    # A matching outline is seeded so the Outline view stays consistent.
    assert [s["title"] for s in d["outline"]["sections"]] == ["Intro", "Body"]


async def test_import_draft_persists_codex_cli_provider(authed_client) -> None:
    client, _ = authed_client
    body = {
        **_import_body("# Codex post\n\n## Body\n\nDraft text."),
        "provider": "codex-cli",
        "model": "codex-default",
    }
    r = client.post("/api/drafts/import", json=body)
    assert r.status_code == 201
    assert r.json()["idea"]["provider"] == "codex-cli"
    assert r.json()["idea"]["model"] == "codex-default"


async def test_import_draft_no_headings_single_section(authed_client) -> None:
    client, _ = authed_client
    r = client.post("/api/drafts/import", json=_import_body("Just prose, no headings here."))
    assert r.status_code == 201
    d = r.json()
    assert len(d["sections"]) == 1
    assert d["sections"][0]["content_md"] == "Just prose, no headings here."


async def test_import_draft_empty_rejected(authed_client) -> None:
    client, _ = authed_client
    r = client.post("/api/drafts/import", json=_import_body("   \n  "))
    assert r.status_code == 422
