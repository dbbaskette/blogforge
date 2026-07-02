"""GET /api/formats — built-in output formats for the compose picker."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_list_formats_returns_builtin_formats(client: TestClient) -> None:
    r = client.get("/api/formats")
    assert r.status_code == 200
    body = r.json()
    names = {f["name"] for f in body}
    assert "product-release" in names
    assert len(body) == 6


def test_list_formats_entries_have_name_and_description(client: TestClient) -> None:
    r = client.get("/api/formats")
    assert r.status_code == 200
    for f in r.json():
        assert f["name"]
        assert f["description"]
