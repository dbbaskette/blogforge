"""GET /api/drafts/{id}/download."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def dl_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    from pencraft.server import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


def test_download_returns_markdown(dl_client: TestClient) -> None:
    created = dl_client.post(
        "/api/drafts",
        json={"topic": "Hello", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = dl_client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    assert "text/markdown" in r.headers["content-type"]
    assert "# Hello" in r.text


def test_download_content_disposition_header(dl_client: TestClient) -> None:
    created = dl_client.post(
        "/api/drafts",
        json={"topic": "My Post", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = dl_client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    assert ".md" in r.headers["content-disposition"]


def test_download_unknown_404(dl_client: TestClient) -> None:
    r = dl_client.get("/api/drafts/nope/download")
    assert r.status_code == 404
