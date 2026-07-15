"""`_auto_select_provider` — server-side provider default for keyless voice ops.

The rule: prefer the local `claude -p` CLI (keyless Max-subscription auth) when
it's installed, over stored API keys — the user's subscription is the default
writing engine. Fall back to a configured API key (anthropic > openai > google)
when the CLI isn't installed, then a bound Tanzu gateway, else nothing.
"""

from __future__ import annotations

import uuid

import pytest

from blogforge.api.voice import _auto_select_provider, _default_model
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.keys import KeyVault


async def _user_with_default(default_provider: str) -> User:
    user = User(
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        status="approved",
        role="user",
        default_provider=default_provider,
    )
    async with get_sessionmaker()() as session:
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user


@pytest.mark.parametrize("default_provider", ["codex-cli", "openai"])
async def test_returns_explicit_user_default_before_legacy_selection(
    default_provider: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: True)
    user = await _user_with_default(default_provider)

    assert await _auto_select_provider(user.id) == default_provider


async def test_returns_explicit_default_even_when_provider_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: False)
    user = await _user_with_default("codex-cli")

    assert await _auto_select_provider(user.id) == "codex-cli"


def test_codex_cli_uses_codex_default_model() -> None:
    assert _default_model("codex-cli") == "codex-default"


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


async def test_uses_tanzu_when_null_preference_and_no_cli_or_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from blogforge.config import get_settings

    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: False)
    monkeypatch.setenv("BLOGFORGE_TANZU_API_BASE", "https://tanzu.example.test")
    monkeypatch.setenv("BLOGFORGE_TANZU_API_KEY", "tanzu-key")
    get_settings.cache_clear()

    assert await _auto_select_provider(uuid.uuid4()) == "tanzu"
