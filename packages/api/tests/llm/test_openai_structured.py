"""OpenAI adapter — json_schema (response_format) path."""
from __future__ import annotations

import json as _json

import httpx
import pytest
import respx

from pencraft.llm.exceptions import ProviderError
from pencraft.llm.openai import OpenAIProvider

_SIMPLE_SCHEMA = {
    "type": "object",
    "properties": {"value": {"type": "string"}},
    "required": ["value"],
    "additionalProperties": False,
}


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_sends_response_format() -> None:
    provider = OpenAIProvider(api_key="sk-test")
    route = respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "c1",
                "model": "gpt-5",
                "choices": [{
                    "message": {"content": '{"value": "ok"}'},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 5, "completion_tokens": 3},
            },
        )
    )
    resp = await provider.complete(
        model="gpt-5", prompt="give me a value", json_schema=_SIMPLE_SCHEMA
    )
    assert _json.loads(resp.text) == {"value": "ok"}
    body = _json.loads(route.calls.last.request.content.decode())
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["response_format"]["json_schema"]["schema"] == _SIMPLE_SCHEMA


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_retries_on_invalid_json() -> None:
    provider = OpenAIProvider(api_key="sk-test")
    bad = httpx.Response(
        200,
        json={
            "id": "c1", "model": "gpt-5",
            "choices": [{"message": {"content": "not json"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
        },
    )
    good = httpx.Response(
        200,
        json={
            "id": "c2", "model": "gpt-5",
            "choices": [{
                "message": {"content": '{"value": "fixed"}'},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 8, "completion_tokens": 4},
        },
    )
    respx.post("https://api.openai.com/v1/chat/completions").mock(side_effect=[bad, good])
    resp = await provider.complete(
        model="gpt-5", prompt="x", json_schema=_SIMPLE_SCHEMA
    )
    assert _json.loads(resp.text) == {"value": "fixed"}


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_fails_after_two_invalid() -> None:
    provider = OpenAIProvider(api_key="sk-test")
    bad = httpx.Response(
        200,
        json={
            "id": "c1", "model": "gpt-5",
            "choices": [{"message": {"content": "still not json"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
        },
    )
    respx.post("https://api.openai.com/v1/chat/completions").mock(side_effect=[bad, bad])
    with pytest.raises(ProviderError) as exc:
        await provider.complete(model="gpt-5", prompt="x", json_schema=_SIMPLE_SCHEMA)
    assert exc.value.code == "analyze_invalid_json"
