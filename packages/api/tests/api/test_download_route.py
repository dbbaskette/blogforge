"""GET /api/drafts/{id}/download."""
from __future__ import annotations


async def test_download_returns_markdown(authed_client) -> None:
    client, _ = authed_client
    created = client.post(
        "/api/drafts",
        json={"topic": "Hello", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    assert "text/markdown" in r.headers["content-type"]
    assert "# Hello" in r.text


async def test_download_content_disposition_header(authed_client) -> None:
    client, _ = authed_client
    created = client.post(
        "/api/drafts",
        json={"topic": "My Post", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    assert ".md" in r.headers["content-disposition"]


async def test_download_unknown_404(authed_client) -> None:
    client, _ = authed_client
    r = client.get("/api/drafts/nope/download")
    assert r.status_code == 404
