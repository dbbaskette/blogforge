"""POST /api/drafts/{id}/outline."""
from __future__ import annotations

import json
import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from pencraft.server import create_app

_MYVOICE_DAN = Path("/Users/dbbaskette/Projects/myvoice/packs/dan")

_CANNED = {
    "opening_hook": "An opening that hooks.",
    "sections": [
        {"id": "s1", "title": "Section one", "brief": "First."},
        {"id": "s2", "title": "Section two", "brief": "Second."},
    ],
    "estimated_words": 800,
}


@pytest.fixture
def outline_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    if not _MYVOICE_DAN.exists():
        pytest.skip("requires myvoice's dan pack")

    packs_root = tmp_path / "packs"
    packs_root.mkdir()
    shutil.copytree(_MYVOICE_DAN, packs_root / "dan")

    cfg_path = tmp_path / "myvoice_config.yaml"
    cfg_path.write_text(yaml.safe_dump({"providers": {"anthropic": {"api_key": "sk-mock"}}}))

    monkeypatch.setenv("MYVOICE_PACKS_ROOT", str(packs_root))
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(cfg_path))
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    monkeypatch.setenv("PENCRAFT_TEST_PROVIDER", "mock")
    monkeypatch.setenv("PENCRAFT_MOCK_OUTPUT_JSON", json.dumps(_CANNED))

    app = create_app()
    with TestClient(app) as c:
        yield c


def test_generate_outline_happy_path(outline_client: TestClient) -> None:
    created = outline_client.post(
        "/api/drafts",
        json={
            "topic": "AI agents",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "mock-1",
            "target_words": 1200,
        },
    ).json()
    r = outline_client.post(f"/api/drafts/{created['id']}/outline")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stage"] == "outline"
    assert body["outline"]["opening_hook"] == "An opening that hooks."
    assert len(body["outline"]["sections"]) == 2
    assert len(body["sections"]) == 2  # seeded


def test_generate_outline_draft_not_found(outline_client: TestClient) -> None:
    r = outline_client.post("/api/drafts/nope/outline")
    assert r.status_code == 404
