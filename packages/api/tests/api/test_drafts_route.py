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
