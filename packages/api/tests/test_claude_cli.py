"""ClaudeCliProvider: JSON coercion, model list, availability gating."""
from __future__ import annotations

import pytest

from blogforge.llm.claude_cli import ClaudeCliProvider, _coerce_json, claude_available


def test_coerce_json_strips_fences() -> None:
    assert _coerce_json('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert _coerce_json('Here you go:\n```\n{"b": 2}\n```') == '{"b": 2}'


def test_coerce_json_extracts_bare_object() -> None:
    assert _coerce_json('prose before {"x": [1,2]} prose after') == '{"x": [1,2]}'
    assert _coerce_json('{"clean": true}') == '{"clean": true}'


@pytest.mark.asyncio
async def test_list_models_returns_cli_aliases() -> None:
    models = await ClaudeCliProvider().list_models()
    ids = {m.id for m in models}
    assert {"opus", "sonnet", "haiku"} <= ids
    # Subscription-based: no per-token price, and we don't claim streaming.
    for m in models:
        assert m.input_per_million_usd is None
        assert not m.supports_streaming


@pytest.mark.asyncio
async def test_keyvault_claude_cli_sentinel_tracks_binary(monkeypatch: pytest.MonkeyPatch) -> None:
    from blogforge.keys import KeyVault

    monkeypatch.setattr("blogforge.llm.claude_cli.shutil.which", lambda _: "/usr/bin/claude")
    assert await KeyVault().get("claude-cli") == "cli"
    monkeypatch.setattr("blogforge.llm.claude_cli.shutil.which", lambda _: None)
    assert await KeyVault().get("claude-cli") == ""


def test_claude_available_reflects_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("blogforge.llm.claude_cli.shutil.which", lambda _: "/usr/bin/claude")
    assert claude_available() is True
    monkeypatch.setattr("blogforge.llm.claude_cli.shutil.which", lambda _: None)
    assert claude_available() is False
