"""Provider registry and HTTP exposure for the keyless Codex CLI."""

from __future__ import annotations

import pytest

from blogforge.llm.codex_cli import CodexCliProvider
from blogforge.llm.registry import get_provider


def test_registry_resolves_codex_cli() -> None:
    assert isinstance(get_provider("codex-cli", ""), CodexCliProvider)


def test_provider_list_reports_codex_availability(
    authed_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("blogforge.llm.codex_cli.codex_available", lambda: True)
    client, _ = authed_client

    response = client.get("/api/providers")

    assert response.status_code == 200
    assert response.json()["codex-cli"] is True


def test_codex_status_route_returns_exact_payload(
    authed_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = {"installed": True, "authenticated": True, "detail": "ready", "resolve": ""}

    async def fake_status() -> dict[str, object]:
        return payload

    monkeypatch.setattr("blogforge.llm.codex_cli.codex_status", fake_status)
    client, _ = authed_client

    response = client.get("/api/providers/codex-cli/status")

    assert response.status_code == 200
    assert response.json() == payload


def test_codex_models_returns_synthetic_default(authed_client) -> None:
    client, _ = authed_client

    response = client.get("/api/providers/codex-cli/models")

    assert response.status_code == 200
    assert response.json()[0]["id"] == "codex-default"
