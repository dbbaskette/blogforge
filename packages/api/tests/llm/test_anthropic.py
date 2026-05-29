"""Anthropic adapter — mocked HTTP via respx."""
from __future__ import annotations

import httpx
import pytest
import respx

from blogforge.llm.anthropic import AnthropicProvider
from blogforge.llm.base import StreamChunk
from blogforge.llm.exceptions import ProviderMissingKey, ProviderRateLimit


@pytest.mark.asyncio
async def test_missing_key_raises_on_init() -> None:
    with pytest.raises(ProviderMissingKey):
        AnthropicProvider(api_key="")


@pytest.mark.asyncio
@respx.mock
async def test_complete_happy_path() -> None:
    provider = AnthropicProvider(api_key="sk-test")
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello there."}],
                "model": "claude-sonnet-4-6",
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 12, "output_tokens": 4},
            },
        )
    )
    resp = await provider.complete(model="claude-sonnet-4-6", prompt="Hi")
    assert resp.text == "Hello there."
    assert resp.input_tokens == 12
    assert resp.output_tokens == 4
    assert resp.model == "claude-sonnet-4-6"
    assert resp.finish_reason == "stop"


@pytest.mark.asyncio
@respx.mock
async def test_rate_limit_maps_to_typed_error() -> None:
    provider = AnthropicProvider(api_key="sk-test")
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            429,
            headers={"retry-after": "30"},
            json={"error": {"message": "rate limit"}},
        )
    )
    with pytest.raises(ProviderRateLimit) as exc:
        await provider.complete(model="claude-sonnet-4-6", prompt="Hi")
    assert exc.value.retry_after_seconds == 30


@pytest.mark.asyncio
@respx.mock
async def test_stream_yields_deltas_and_final_usage() -> None:
    provider = AnthropicProvider(api_key="sk-test")

    # Anthropic streams as SSE: event lines + data lines.
    msg_start = (
        '{"type":"message_start","message":{"id":"m","model":"claude-sonnet-4-6",'
        '"usage":{"input_tokens":10,"output_tokens":0}}}'
    )
    msg_delta = (
        '{"type":"message_delta","delta":{"stop_reason":"end_turn"},'
        '"usage":{"output_tokens":2}}'
    )
    sse_body = (
        "event: message_start\n"
        f"data: {msg_start}\n\n"
        "event: content_block_delta\n"
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n'
        "event: content_block_delta\n"
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n'
        "event: message_delta\n"
        f"data: {msg_delta}\n\n"
        "event: message_stop\n"
        'data: {"type":"message_stop"}\n\n'
    )
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            content=sse_body,
            headers={"content-type": "text/event-stream"},
        )
    )

    chunks: list[StreamChunk] = []
    async for c in provider.stream(model="claude-sonnet-4-6", prompt="Hi"):
        chunks.append(c)

    deltas = [c.delta for c in chunks if c.delta]
    assert "".join(deltas) == "Hello world"
    final = next(c for c in chunks if c.usage is not None)
    assert final.usage is not None
    assert final.usage.input_tokens == 10
    assert final.usage.output_tokens == 2
    assert final.usage.finish_reason == "stop"


@pytest.mark.asyncio
@respx.mock
async def test_list_models_returns_known_set() -> None:
    provider = AnthropicProvider(api_key="sk-test")
    respx.get("https://api.anthropic.com/v1/models").mock(
        return_value=httpx.Response(
            200,
            json={"data": [
                {"id": "claude-opus-4-7", "display_name": "Claude Opus 4.7"},
                {"id": "claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6"},
            ]},
        )
    )
    models = await provider.list_models()
    ids = [m.id for m in models]
    assert "claude-sonnet-4-6" in ids
    # rate-card metadata is preserved (context window from rates.yaml)
    sonnet = next(m for m in models if m.id == "claude-sonnet-4-6")
    assert sonnet.context_window == 200_000
