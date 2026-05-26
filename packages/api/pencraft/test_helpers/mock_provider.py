"""Scripted LLM provider for tests. Activated by env var PENCRAFT_TEST_PROVIDER=mock."""
from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator

from pencraft.llm.base import LLMResponse, ModelInfo, StreamChunk, Usage


class MockProvider:
    name = "mock"

    def __init__(self, api_key: str = "mock") -> None:
        pass  # env vars are read per-call so monkeypatching takes effect after construction

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(id="mock-1", label="Mock Model", context_window=8000, supports_streaming=True)
        ]

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        # Read env vars here (not in __init__) so per-test monkeypatching takes effect.
        json_output = os.environ.get("PENCRAFT_MOCK_OUTPUT_JSON")
        text_output = os.environ.get("PENCRAFT_MOCK_OUTPUT", "Hello from the mock.")
        text = json_output if (json_schema is not None and json_output) else text_output
        return LLMResponse(
            text=text,
            input_tokens=len(prompt.split()),
            output_tokens=len(text.split()),
            model=model,
            finish_reason="stop",
        )

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        text = os.environ.get("PENCRAFT_MOCK_OUTPUT", "Hello from the mock.")
        for chunk in text.split(" "):
            await asyncio.sleep(0.005)
            yield StreamChunk(delta=chunk + " ")
        yield StreamChunk(usage=Usage(
            input_tokens=len(prompt.split()),
            output_tokens=len(text.split()),
            finish_reason="stop",
        ))
