"""CRUD route tests for /api/drafts."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pencraft.server import create_app


@pytest.fixture
def client_with_drafts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app) as c:
        yield c


def _idea_json() -> dict:  # type: ignore[type-arg]
    return {
        "topic": "Test topic",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "target_words": 1200,
    }


def test_create_draft(client_with_drafts: TestClient) -> None:
    r = client_with_drafts.post("/api/drafts", json=_idea_json())
    assert r.status_code == 201
    body = r.json()
    assert body["idea"]["topic"] == "Test topic"
    assert body["stage"] == "idea"


def test_list_drafts(client_with_drafts: TestClient) -> None:
    client_with_drafts.post("/api/drafts", json=_idea_json())
    client_with_drafts.post("/api/drafts", json=_idea_json())
    r = client_with_drafts.get("/api/drafts")
    assert r.status_code == 200
    summaries = r.json()
    assert len(summaries) == 2


def test_get_draft(client_with_drafts: TestClient) -> None:
    created = client_with_drafts.post("/api/drafts", json=_idea_json()).json()
    r = client_with_drafts.get(f"/api/drafts/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_unknown_404(client_with_drafts: TestClient) -> None:
    r = client_with_drafts.get("/api/drafts/nope")
    assert r.status_code == 404


def test_update_draft(client_with_drafts: TestClient) -> None:
    created = client_with_drafts.post("/api/drafts", json=_idea_json()).json()
    created["title"] = "Updated title"
    r = client_with_drafts.put(f"/api/drafts/{created['id']}", json=created)
    assert r.status_code == 200
    assert r.json()["title"] == "Updated title"


def test_delete_draft(client_with_drafts: TestClient) -> None:
    created = client_with_drafts.post("/api/drafts", json=_idea_json()).json()
    r = client_with_drafts.delete(f"/api/drafts/{created['id']}")
    assert r.status_code == 204
    r2 = client_with_drafts.get(f"/api/drafts/{created['id']}")
    assert r2.status_code == 404


def test_put_does_not_regress_stage_or_clobber_outline(client_with_drafts: TestClient) -> None:
    """Regression: a stale Stage 1 auto-save must not wipe a freshly-generated outline."""
    created = client_with_drafts.post("/api/drafts", json=_idea_json()).json()
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
    r = client_with_drafts.put(f"/api/drafts/{created['id']}", json=promoted)
    assert r.status_code == 200
    assert r.json()["stage"] == "outline"

    stale = dict(created)
    stale["stage"] = "idea"
    stale["outline"] = None
    stale["sections"] = []
    r = client_with_drafts.put(f"/api/drafts/{created['id']}", json=stale)
    assert r.status_code == 200
    body = r.json()
    assert body["stage"] == "outline", "stage should not regress idea ← outline"
    assert body["outline"] is not None, "outline must not be clobbered by stale PUT"
    assert len(body["sections"]) == 1, "sections must not be clobbered"
