"""POST /api/drafts/{id}/humanize."""

import pytest


@pytest.mark.asyncio
async def test_humanize_route_returns_report(authed_client, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    from blogforge.test_helpers.mock_provider import MockProvider

    resolved: list[str] = []

    async def resolve_provider(_user_id, provider: str):  # type: ignore[no-untyped-def]
        resolved.append(provider)
        return MockProvider()

    monkeypatch.setattr("blogforge.api.geo.build_provider_for", resolve_provider)
    client, _user_id = authed_client
    # Create a draft (voice-profile mode — no pack_slug needed) the pass can run on.
    draft = client.post(
        "/api/drafts",
        json={"topic": "t", "provider": "codex-cli", "model": "codex-default"},
    ).json()
    assert draft["idea"]["provider"] == "codex-cli"
    did = draft["id"]
    r = client.post(f"/api/drafts/{did}/humanize", json={"intensity": "light"})
    assert r.status_code == 200
    body = r.json()
    assert body["intensity"] == "light"
    assert [g["key"] for g in body["lenses"]] == ["flow", "soul"]
    assert isinstance(body["score"], int)
    assert resolved == ["codex-cli"]


@pytest.mark.asyncio
async def test_humanize_route_rejects_bad_intensity(authed_client, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    client, _ = authed_client
    draft = client.post(
        "/api/drafts", json={"topic": "t", "provider": "claude-cli", "model": "opus"}
    ).json()
    r = client.post(f"/api/drafts/{draft['id']}/humanize", json={"intensity": "extreme"})
    assert r.status_code == 422
