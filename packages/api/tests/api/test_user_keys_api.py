"""Tests for /api/keys per-user provider key management."""
from __future__ import annotations

import pytest


def test_set_get_delete_key(authed_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")  # PUT validation uses the provider
    client, _uid = authed_client
    assert client.get("/api/keys").json()["anthropic"] is False
    r = client.put("/api/keys/anthropic", json={"api_key": "sk-x"})
    assert r.status_code in (200, 204)
    assert client.get("/api/keys").json()["anthropic"] is True
    client.delete("/api/keys/anthropic")
    assert client.get("/api/keys").json()["anthropic"] is False


def test_unknown_provider_404(authed_client) -> None:
    client, _ = authed_client
    assert client.put("/api/keys/bogus", json={"api_key": "x"}).status_code == 404
