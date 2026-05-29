"""Google adapter — response_schema path + dialect adapter."""
from __future__ import annotations

import json as _json
from typing import cast

import httpx
import pytest
import respx

from blogforge.llm.exceptions import ProviderError
from blogforge.llm.google import GoogleProvider, to_google_schema

_SIMPLE_SCHEMA = {
    "type": "object",
    "properties": {"value": {"type": "string"}},
    "required": ["value"],
    "additionalProperties": False,
}


def test_to_google_schema_drops_metadata() -> None:
    src: dict[str, object] = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
    }
    out = to_google_schema(src)
    assert "$schema" not in out
    assert out["type"] == "object"


def test_to_google_schema_converts_nullable() -> None:
    src: dict[str, object] = {"type": ["string", "null"]}
    out = to_google_schema(src)
    assert out["type"] == "string"
    assert out["nullable"] is True


def test_to_google_schema_drops_additional_properties() -> None:
    """Google's schema dialect doesn't support additionalProperties."""
    src: dict[str, object] = {
        "type": "object",
        "properties": {"a": {"type": "string"}},
        "additionalProperties": False,
    }
    out = to_google_schema(src)
    assert "additionalProperties" not in out
    props = cast(dict[str, object], out["properties"])
    a_schema = cast(dict[str, object], props["a"])
    assert a_schema["type"] == "string"


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_sends_response_schema() -> None:
    provider = GoogleProvider(api_key="g-test")
    route = respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    ).mock(return_value=httpx.Response(
        200,
        json={
            "candidates": [{
                "content": {"parts": [{"text": '{"value": "ok"}'}]},
                "finishReason": "STOP",
            }],
            "usageMetadata": {"promptTokenCount": 4, "candidatesTokenCount": 3},
        },
    ))
    resp = await provider.complete(
        model="gemini-2.5-pro", prompt="give me", json_schema=_SIMPLE_SCHEMA
    )
    assert _json.loads(resp.text) == {"value": "ok"}
    body = _json.loads(route.calls.last.request.content.decode())
    assert body["generationConfig"]["response_mime_type"] == "application/json"
    # additionalProperties should have been stripped by to_google_schema
    assert "additionalProperties" not in body["generationConfig"]["response_schema"]


@pytest.mark.asyncio
@respx.mock
async def test_complete_with_schema_fails_after_two_invalid() -> None:
    provider = GoogleProvider(api_key="g-test")
    bad = httpx.Response(
        200,
        json={
            "candidates": [{
                "content": {"parts": [{"text": "not json"}]},
                "finishReason": "STOP",
            }],
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2},
        },
    )
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    ).mock(side_effect=[bad, bad])
    with pytest.raises(ProviderError) as exc:
        await provider.complete(
            model="gemini-2.5-pro", prompt="x", json_schema=_SIMPLE_SCHEMA
        )
    assert exc.value.code == "analyze_invalid_json"
