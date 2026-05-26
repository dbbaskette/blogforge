"""Resolve a provider name + api key to an LLMProvider instance."""
from __future__ import annotations

import os
from collections.abc import Callable

from pencraft.llm.anthropic import AnthropicProvider
from pencraft.llm.base import LLMProvider
from pencraft.llm.exceptions import ProviderError, ProviderMissingKey  # noqa: F401
from pencraft.llm.google import GoogleProvider
from pencraft.llm.openai import OpenAIProvider

_FACTORIES: dict[str, Callable[[str], LLMProvider]] = {
    "anthropic": lambda api_key: AnthropicProvider(api_key=api_key),
    "openai": lambda api_key: OpenAIProvider(api_key=api_key),
    "google": lambda api_key: GoogleProvider(api_key=api_key),
}


def get_provider(name: str, api_key: str) -> LLMProvider:
    if os.environ.get("PENCRAFT_TEST_PROVIDER") == "mock":
        from pencraft.test_helpers.mock_provider import MockProvider
        return MockProvider(api_key=api_key or "mock")
    if name not in _FACTORIES:
        raise ProviderError(f"Unknown provider: {name}")
    return _FACTORIES[name](api_key)
