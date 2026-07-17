"""CRUD for reusable draft templates."""
from __future__ import annotations


def _template_json() -> dict[str, object]:
    return {
        "name": "Weekly essay",
        "topic": "",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-x",
        "target_words": 1200,
        "bullets": ["a point", "another"],
        "notes": "keep it punchy",
    }


def _idea_json() -> dict[str, object]:
    return {
        "topic": "Source draft",
        "pack_slug": "dan",
        "provider": "anthropic",
        "model": "claude-x",
        "target_words": 900,
        "bullets": ["from draft"],
        "notes": "draft notes",
    }


async def test_create_list_delete_template(authed_client) -> None:
    client, _ = authed_client

    created = client.post("/api/templates", json=_template_json())
    assert created.status_code == 201
    tid = created.json()["id"]
    assert created.json()["name"] == "Weekly essay"
    assert created.json()["bullets"] == ["a point", "another"]

    listed = client.get("/api/templates").json()
    assert [t["id"] for t in listed] == [tid]

    assert client.delete(f"/api/templates/{tid}").status_code == 204
    assert client.get("/api/templates").json() == []


async def test_create_template_persists_codex_cli_provider(authed_client) -> None:
    client, _ = authed_client
    body = {**_template_json(), "provider": "codex-cli", "model": "codex-default"}
    created = client.post("/api/templates", json=body)
    assert created.status_code == 201
    assert created.json()["provider"] == "codex-cli"
    assert created.json()["model"] == "codex-default"


async def test_create_from_draft_lifts_idea_defaults(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea_json()).json()["id"]

    r = client.post(f"/api/templates/from-draft/{did}", json={"name": "From my draft"})
    assert r.status_code == 201
    tmpl = r.json()
    assert tmpl["name"] == "From my draft"
    assert tmpl["topic"] == "Source draft"
    assert tmpl["pack_slug"] == "dan"
    assert tmpl["target_words"] == 900
    assert tmpl["bullets"] == ["from draft"]
    assert tmpl["notes"] == "draft notes"


async def test_create_from_unknown_draft_404(authed_client) -> None:
    from uuid import uuid4

    client, _ = authed_client
    r = client.post(f"/api/templates/from-draft/{uuid4()}", json={"name": "x"})
    assert r.status_code == 404


async def test_delete_unknown_template_404(authed_client) -> None:
    from uuid import uuid4

    client, _ = authed_client
    assert client.delete(f"/api/templates/{uuid4()}").status_code == 404


async def test_blank_name_422(authed_client) -> None:
    client, _ = authed_client
    bad = {**_template_json(), "name": ""}
    assert client.post("/api/templates", json=bad).status_code == 422


async def test_templates_scoped_per_user(authed_client) -> None:
    from tests.conftest import _seed_approved_user, _signed_client

    client, _ = authed_client
    tid = client.post("/api/templates", json=_template_json()).json()["id"]

    other_id = await _seed_approved_user(email="other-tmpl@user.com")
    with _signed_client(other_id) as other:
        assert other.get("/api/templates").json() == []
        # Can't delete someone else's template.
        assert other.delete(f"/api/templates/{tid}").status_code == 404
