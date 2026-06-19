"""Tests for Tanzu provider availability and model listing."""
from __future__ import annotations


def test_tanzu_available_and_models(authed_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TANZU_API_BASE", "https://g/v1")
    monkeypatch.setenv("BLOGFORGE_TANZU_API_KEY", "k")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    client, _ = authed_client
    assert client.get("/api/providers").json().get("tanzu") is True
    ids = [m["id"] for m in client.get("/api/providers/tanzu/models").json()]
    assert "openai/gpt-oss-120b" in ids and all("nomic" not in i for i in ids)


def test_tanzu_absent_when_unconfigured(authed_client, monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.delenv("BLOGFORGE_TANZU_API_KEY", raising=False)
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    client, _ = authed_client
    assert client.get("/api/providers").json().get("tanzu") is False
