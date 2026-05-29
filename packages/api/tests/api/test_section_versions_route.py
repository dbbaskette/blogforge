"""Section version history: save/regenerate snapshots prior content;
list + revert restore it (and revert is itself undoable)."""
from __future__ import annotations


def _seed(client, *, s1_content: str = "") -> str:
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
            "content_md": s1_content, "status": "ready" if s1_content else "empty",
            "word_count": len(s1_content.split()),
        },
        {
            "id": "s2", "title": "B", "brief": "",
            "content_md": "", "status": "empty", "word_count": 0,
        },
    ]
    created["stage"] = "sections"
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]


async def test_save_snapshots_prior_content(authed_client) -> None:
    client, _ = authed_client
    did = _seed(client, s1_content="original one two")

    # Overwriting via save snapshots the prior content.
    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "brand new text"})

    versions = client.get(f"/api/drafts/{did}/sections/s1/versions").json()
    assert len(versions) == 1
    assert versions[0]["content_md"] == "original one two"
    assert versions[0]["source"] == "save"
    assert versions[0]["word_count"] == 3


async def test_empty_prior_content_is_not_snapshotted(authed_client) -> None:
    """Saving over a blank section keeps the history clean."""
    client, _ = authed_client
    did = _seed(client)  # s1 starts empty

    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "first real content"})
    assert client.get(f"/api/drafts/{did}/sections/s1/versions").json() == []


async def test_versions_newest_first(authed_client) -> None:
    client, _ = authed_client
    did = _seed(client, s1_content="v1")
    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "v2"})
    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "v3"})

    versions = client.get(f"/api/drafts/{did}/sections/s1/versions").json()
    assert [v["content_md"] for v in versions] == ["v2", "v1"]


async def test_revert_restores_and_is_undoable(authed_client) -> None:
    client, _ = authed_client
    did = _seed(client, s1_content="v1")
    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "v2"})
    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "v3"})

    # Find the v1 snapshot and revert to it.
    versions = client.get(f"/api/drafts/{did}/sections/s1/versions").json()
    v1_id = next(v["id"] for v in versions if v["content_md"] == "v1")

    r = client.post(f"/api/drafts/{did}/sections/s1/versions/{v1_id}/revert")
    assert r.status_code == 200
    s1 = next(s for s in r.json()["sections"] if s["id"] == "s1")
    assert s1["content_md"] == "v1"
    assert s1["status"] == "edited"

    # The live "v3" content was snapshotted (source=revert) so the revert undoes.
    after = client.get(f"/api/drafts/{did}/sections/s1/versions").json()
    assert any(v["content_md"] == "v3" and v["source"] == "revert" for v in after)


async def test_revert_unknown_version_404(authed_client) -> None:
    from uuid import uuid4

    client, _ = authed_client
    did = _seed(client, s1_content="v1")
    r = client.post(f"/api/drafts/{did}/sections/s1/versions/{uuid4()}/revert")
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "version_not_found"


async def test_versions_unknown_section_404(authed_client) -> None:
    client, _ = authed_client
    did = _seed(client, s1_content="v1")
    r = client.get(f"/api/drafts/{did}/sections/nope/versions")
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "section_not_found"


async def test_versions_cross_user_isolated(authed_client) -> None:
    from tests.conftest import _seed_approved_user, _signed_client

    client, _ = authed_client
    did = _seed(client, s1_content="v1")
    client.post(f"/api/drafts/{did}/sections/s1/save", json={"content_md": "v2"})

    # A different user can't see this draft's section versions — draft 404s.
    other_id = await _seed_approved_user(email="other@user.com")
    with _signed_client(other_id) as other:
        assert other.get(f"/api/drafts/{did}/sections/s1/versions").status_code == 404
