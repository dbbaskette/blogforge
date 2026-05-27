"""POST /api/drafts/{id}/sections/{id}/save + reorder."""
from __future__ import annotations


def _seed(client) -> str:
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


async def test_save_section_sets_edited(authed_client) -> None:
    client, _ = authed_client
    did = _seed(client)
    r = client.post(
        f"/api/drafts/{did}/sections/s1/save",
        json={"content_md": "Some new content here."},
    )
    assert r.status_code == 200
    s1 = next(s for s in r.json()["sections"] if s["id"] == "s1")
    assert s1["status"] == "edited"
    assert s1["content_md"] == "Some new content here."
    assert s1["word_count"] == 4


async def test_reorder_sections(authed_client) -> None:
    client, _ = authed_client
    did = _seed(client)
    r = client.post(
        f"/api/drafts/{did}/sections/reorder",
        json={"section_ids": ["s2", "s1"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert [s["id"] for s in body["sections"]] == ["s2", "s1"]
    assert [s["id"] for s in body["outline"]["sections"]] == ["s2", "s1"]
