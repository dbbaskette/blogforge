"""`_auto_select_provider` — server-side provider default for keyless voice ops.

The rule: prefer the local `claude -p` CLI (keyless Max-subscription auth) when
it's installed, over stored API keys — the user's subscription is the default
writing engine. Fall back to a configured API key (anthropic > openai > google)
when the CLI isn't installed, then a bound Tanzu gateway, else nothing.
"""

from __future__ import annotations

import uuid

import pytest

from blogforge.api.voice import _auto_select_provider
from blogforge.keys import KeyVault


async def test_prefers_claude_cli_over_a_configured_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # New rule: the installed CLI (subscription auth) wins over stored keys.
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: True)
    user_id = uuid.uuid4()
    await KeyVault(user_id).set("openai", "sk-openai")
    assert await _auto_select_provider(user_id) == "claude-cli"


async def test_uses_api_key_when_cli_not_installed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No CLI -> fall back to a configured vault key.
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: False)
    user_id = uuid.uuid4()
    await KeyVault(user_id).set("openai", "sk-openai")
    assert await _auto_select_provider(user_id) == "openai"


async def test_falls_back_to_claude_cli_when_installed_and_no_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No vault keys + binary present -> claude-cli (the bug this fixes: the old
    # loop checked vault.get("claude-cli"), which is always falsy).
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: True)
    assert await _auto_select_provider(uuid.uuid4()) == "claude-cli"


async def test_returns_none_when_no_keys_no_cli_no_tanzu(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from blogforge.config import get_settings

    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: False)
    # Order-independence: a prior tanzu test can leave BLOGFORGE_TANZU_* in the
    # shared settings cache, which would make _auto_select fall through to tanzu.
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.delenv("BLOGFORGE_TANZU_API_KEY", raising=False)
    get_settings.cache_clear()
    assert await _auto_select_provider(uuid.uuid4()) is None
