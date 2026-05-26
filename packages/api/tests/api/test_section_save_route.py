"""POST /api/drafts/{id}/sections/{id}/save + reorder."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pencraft.server import create_app


@pytest.fixture
def section_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app) as c:
        yield c


def _seed(client: TestClient) -> str:
    created = client.post(
        "/api/drafts",
        json={
            "topic": "X",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "m",
        },
    ).json()
    created["outline"] = {
        "opening_hook": "H",
        "sections": [
            {"id": "s1", "title": "A", "brief": ""},
            {"id": "s2", "title": "B", "brief": ""},
        ],
        "estimated_words": 0,
    }
    created["sections"] = [
        {
            "id": "s1", "title": "A", "brief": "",
            "content_md": "", "status": "empty", "word_count": 0,
        },
        {
            "id": "s2", "title": "B", "brief": "",
            "content_md": "", "status": "empty", "word_count": 0,
        },
    ]
    created["stage"] = "sections"
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]  # type: ignore[no-any-return]


def test_save_section_sets_edited(section_client: TestClient) -> None:
    did = _seed(section_client)
    r = section_client.post(
        f"/api/drafts/{did}/sections/s1/save",
        json={"content_md": "Some new content here."},
    )
    assert r.status_code == 200
    s1 = next(s for s in r.json()["sections"] if s["id"] == "s1")
    assert s1["status"] == "edited"
    assert s1["content_md"] == "Some new content here."
    assert s1["word_count"] == 4


def test_reorder_sections(section_client: TestClient) -> None:
    did = _seed(section_client)
    r = section_client.post(
        f"/api/drafts/{did}/sections/reorder",
        json={"section_ids": ["s2", "s1"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert [s["id"] for s in body["sections"]] == ["s2", "s1"]
    assert [s["id"] for s in body["outline"]["sections"]] == ["s2", "s1"]
