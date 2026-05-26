"""OpenAI adapter — mocked HTTP via respx."""
from __future__ import annotations

import httpx
import pytest
import respx

from pencraft.llm.exceptions import ProviderMissingKey, ProviderRateLimit
from pencraft.llm.openai import OpenAIProvider


def test_missing_key_raises() -> None:
    with pytest.raises(ProviderMissingKey):
        OpenAIProvider(api_key="")


@pytest.mark.asyncio
@respx.mock
async def test_complete_happy_path() -> None:
    p = OpenAIProvider(api_key="sk-test")
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "c1",
                "model": "gpt-5",
                "choices": [{"message": {"content": "Hi!"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 2},
            },
        )
    )
    r = await p.complete(model="gpt-5", prompt="hi")
    assert r.text == "Hi!"
    assert r.input_tokens == 8
    assert r.output_tokens == 2
    assert r.finish_reason == "stop"


@pytest.mark.asyncio
@respx.mock
async def test_stream_yields_deltas() -> None:
    p = OpenAIProvider(api_key="sk-test")
    final_chunk = (
        '{"choices":[{"delta":{},"finish_reason":"stop"}],'
        '"usage":{"prompt_tokens":3,"completion_tokens":2}}'
    )
    sse_body = (
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
        f'data: {final_chunk}\n\n'
        'data: [DONE]\n\n'
    )
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, content=sse_body, headers={"content-type": "text/event-stream"}
        )
    )
    deltas = []
    usage = None
    async for c in p.stream(model="gpt-5", prompt="hi"):
        if c.delta:
            deltas.append(c.delta)
        if c.usage is not None:
            usage = c.usage
    assert "".join(deltas) == "Hello"
    assert usage is not None and usage.output_tokens == 2


@pytest.mark.asyncio
@respx.mock
async def test_rate_limit_maps() -> None:
    p = OpenAIProvider(api_key="sk-test")
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            429, headers={"retry-after": "12"}, json={"error": {"message": "rl"}}
        )
    )
    with pytest.raises(ProviderRateLimit) as e:
        await p.complete(model="gpt-5", prompt="hi")
    assert e.value.retry_after_seconds == 12


@pytest.mark.asyncio
@respx.mock
async def test_list_models() -> None:
    p = OpenAIProvider(api_key="sk-test")
    respx.get("https://api.openai.com/v1/models").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "gpt-5"}, {"id": "gpt-5-mini"}, {"id": "dall-e-3"}]},
        )
    )
    models = await p.list_models()
    ids = [m.id for m in models]
    assert "gpt-5" in ids
    assert "gpt-5-mini" in ids
    assert "dall-e-3" not in ids  # filtered to chat-capable allowlist
