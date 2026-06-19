"""Resolve a provider name + api key to an LLMProvider instance."""
from __future__ import annotations

import os
from collections.abc import Callable

from blogforge.llm.anthropic import AnthropicProvider
from blogforge.llm.base import LLMProvider
from blogforge.llm.claude_cli import ClaudeCliProvider
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey  # noqa: F401
from blogforge.llm.google import GoogleProvider
from blogforge.llm.openai import OpenAIProvider
from blogforge.llm.tanzu import TanzuProvider

_FACTORIES: dict[str, Callable[[str], LLMProvider]] = {
    "anthropic": lambda api_key: AnthropicProvider(api_key=api_key),
    "openai": lambda api_key: OpenAIProvider(api_key=api_key),
    "google": lambda api_key: GoogleProvider(api_key=api_key),
    # Uses the local logged-in Claude Code CLI; api_key is ignored.
    "claude-cli": lambda api_key: ClaudeCliProvider(api_key=api_key),
    # Tanzu GenAI binding — keyless to the user; reads creds from settings.
    "tanzu": lambda _api_key: TanzuProvider.from_settings(),
}


def get_provider(name: str, api_key: str) -> LLMProvider:
    if os.environ.get("BLOGFORGE_TEST_PROVIDER") == "mock":
        from blogforge.test_helpers.mock_provider import MockProvider
        return MockProvider(api_key=api_key or "mock")
    if name not in _FACTORIES:
        raise ProviderError(f"Unknown provider: {name}")
    return _FACTORIES[name](api_key)
