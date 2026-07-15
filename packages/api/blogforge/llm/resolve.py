"""Resolve (user, provider) -> a ready LLMProvider using the user's stored key."""
from __future__ import annotations

import os
from uuid import UUID

from blogforge.keys import KeyVault
from blogforge.llm.base import LLMProvider
from blogforge.llm.exceptions import ProviderMissingKey
from blogforge.llm.registry import get_provider


async def build_provider_for(user_id: UUID, provider: str) -> LLMProvider:
    if os.environ.get("BLOGFORGE_TEST_PROVIDER") == "mock":
        return get_provider(provider, "mock")
    if provider in ("claude-cli", "codex-cli", "tanzu"):
        return get_provider(provider, "")
    api_key = await KeyVault(user_id).get(provider)
    if not api_key:
        raise ProviderMissingKey(provider)
    return get_provider(provider, api_key)
