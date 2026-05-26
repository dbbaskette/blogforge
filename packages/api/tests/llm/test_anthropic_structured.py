"""Anthropic adapter — json_schema (tool-use) path."""
from __future__ import annotations

import httpx
import pytest
import respx

from pencraft.llm.anthropic import AnthropicProvider
from pencraft.llm.exceptions import ProviderError

_SIMPLE_SCHEMA = {
    "type": "object",
    "properties": {"value": {"type": "string"}},
    "required": ["value"],
    "additionalProperties": False,
}


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_uses_tool_use() -> None:
    provider = AnthropicProvider(api_key="sk-test")
    route = respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": "claude-sonnet-4-6",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tu_1",
                        "name": "record_analysis",
                        "input": {"value": "hello"},
                    }
                ],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 5, "output_tokens": 3},
            },
        )
    )
    resp = await provider.complete(
        model="claude-sonnet-4-6", prompt="give me a value", json_schema=_SIMPLE_SCHEMA
    )
    assert resp.text == '{"value":"hello"}' or resp.text == '{"value": "hello"}'
    # Request body should include tools + tool_choice
    sent = route.calls.last.request.content
    import json as _json
    body = _json.loads(sent.decode())
    assert "tools" in body
    assert body["tools"][0]["name"] == "record_analysis"
    assert body["tools"][0]["input_schema"] == _SIMPLE_SCHEMA
    assert body["tool_choice"] == {"type": "tool", "name": "record_analysis"}


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_retries_on_invalid_json() -> None:
    """If LLM emits text instead of tool_use, retry once with a corrective hint."""
    provider = AnthropicProvider(api_key="sk-test")
    bad_then_good = [
        httpx.Response(
            200,
            json={
                "id": "msg_1", "type": "message", "role": "assistant",
                "model": "claude-sonnet-4-6",
                "content": [{"type": "text", "text": "I cannot use the tool"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 5, "output_tokens": 5},
            },
        ),
        httpx.Response(
            200,
            json={
                "id": "msg_2", "type": "message", "role": "assistant",
                "model": "claude-sonnet-4-6",
                "content": [{
                    "type": "tool_use", "id": "tu_1", "name": "record_analysis",
                    "input": {"value": "fixed"},
                }],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 10, "output_tokens": 4},
            },
        ),
    ]
    respx.post("https://api.anthropic.com/v1/messages").mock(side_effect=bad_then_good)
    resp = await provider.complete(
        model="claude-sonnet-4-6", prompt="give me a value", json_schema=_SIMPLE_SCHEMA
    )
    assert '"value"' in resp.text
    assert '"fixed"' in resp.text


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_fails_after_two_invalid_attempts() -> None:
    provider = AnthropicProvider(api_key="sk-test")
    text_resp = httpx.Response(
        200,
        json={
            "id": "msg", "type": "message", "role": "assistant",
            "model": "claude-sonnet-4-6",
            "content": [{"type": "text", "text": "no tool"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 5, "output_tokens": 2},
        },
    )
    respx.post("https://api.anthropic.com/v1/messages").mock(side_effect=[text_resp, text_resp])
    with pytest.raises(ProviderError) as exc:
        await provider.complete(
            model="claude-sonnet-4-6", prompt="give me", json_schema=_SIMPLE_SCHEMA
        )
    assert exc.value.code == "analyze_invalid_json"
