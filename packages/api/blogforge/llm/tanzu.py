"""Tanzu GenAI provider — OpenAI-compatible gateway bound via VCAP_SERVICES (keyless to the user)."""
from __future__ import annotations

from blogforge.config import get_settings
from blogforge.llm.base import ModelInfo
from blogforge.llm.openai import OpenAIProvider


class TanzuProvider(OpenAIProvider):
    name = "tanzu"

    def __init__(self, api_key: str, base_url: str, models: list[str], verify_ssl: bool = True) -> None:
        super().__init__(api_key=api_key, base_url=base_url, verify_ssl=verify_ssl)
        self._models = list(models)

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(id=m, label=m, context_window=32768, supports_streaming=True,
                      input_per_million_usd=None, output_per_million_usd=None)
            for m in self._models
        ]

    @classmethod
    def from_settings(cls) -> "TanzuProvider":
        s = get_settings()
        return cls(
            api_key=s.tanzu_api_key or "bound",
            base_url=s.tanzu_api_base,
            models=s.tanzu_models,
            verify_ssl=s.tanzu_verify_ssl,
        )
