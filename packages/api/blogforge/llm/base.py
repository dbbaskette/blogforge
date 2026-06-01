"""Protocol + shared models for LLM providers."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel


class ModelInfo(BaseModel):
    id: str
    label: str
    context_window: int
    supports_streaming: bool
    input_per_million_usd: float | None = None
    output_per_million_usd: float | None = None


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int
    finish_reason: Literal["stop", "length", "error"] = "stop"


class LLMResponse(BaseModel):
    text: str
    input_tokens: int
    output_tokens: int
    model: str
    finish_reason: Literal["stop", "length", "error"]


class StreamChunk(BaseModel):
    """One chunk from a streaming completion. Either delta or usage is populated."""
    delta: str = ""
    usage: Usage | None = None


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    async def list_models(self) -> list[ModelInfo]: ...

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse: ...

    def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]: ...
