"""Google Gemini adapter — mocked HTTP via respx."""
from __future__ import annotations

import httpx
import pytest
import respx

from blogforge.llm.exceptions import ProviderMissingKey, ProviderRateLimit
from blogforge.llm.google import GoogleProvider


def test_missing_key_raises() -> None:
    with pytest.raises(ProviderMissingKey):
        GoogleProvider(api_key="")


@pytest.mark.asyncio
async def test_list_models_from_rates() -> None:
    # Google list comes from the static rates.yaml allowlist — no HTTP needed.
    p = GoogleProvider(api_key="g-test")
    models = await p.list_models()
    ids = [m.id for m in models]
    assert "gemini-2.5-pro" in ids
    assert "gemini-2.5-flash" in ids


@pytest.mark.asyncio
@respx.mock
async def test_complete_happy_path() -> None:
    p = GoogleProvider(api_key="g-test")
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    ).mock(return_value=httpx.Response(
        200,
        json={
            "candidates": [
                {"content": {"parts": [{"text": "Hello!"}]}, "finishReason": "STOP"}
            ],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 2},
        },
    ))
    r = await p.complete(model="gemini-2.5-pro", prompt="hi")
    assert r.text == "Hello!"
    assert r.input_tokens == 5
    assert r.output_tokens == 2
    assert r.finish_reason == "stop"


@pytest.mark.asyncio
@respx.mock
async def test_stream_yields_deltas() -> None:
    p = GoogleProvider(api_key="g-test")
    # Google streams as a JSON array of objects, each a partial GenerateContentResponse.
    # We use the alt=sse mode to get newline-delimited json events.
    sse_body = (
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\r\n\r\n'
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\r\n\r\n'
        'data: {"candidates":[{"finishReason":"STOP","content":{"parts":[]}}],'
        '"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\r\n\r\n'
    )
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent"
    ).mock(return_value=httpx.Response(
        200, content=sse_body, headers={"content-type": "text/event-stream"}
    ))
    deltas = []
    usage = None
    async for c in p.stream(model="gemini-2.5-pro", prompt="hi"):
        if c.delta:
            deltas.append(c.delta)
        if c.usage:
            usage = c.usage
    assert "".join(deltas) == "Hello"
    assert usage is not None and usage.output_tokens == 2


@pytest.mark.asyncio
@respx.mock
async def test_401_raises_missing_key() -> None:
    p = GoogleProvider(api_key="g-test")
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    ).mock(return_value=httpx.Response(401, json={"error": {"message": "invalid key"}}))
    with pytest.raises(ProviderMissingKey):
        await p.complete(model="gemini-2.5-pro", prompt="hi")


@pytest.mark.asyncio
@respx.mock
async def test_403_raises_missing_key() -> None:
    # Google returns 403 for invalid API keys — both 401 and 403 map to ProviderMissingKey.
    p = GoogleProvider(api_key="g-test")
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    ).mock(return_value=httpx.Response(403, json={"error": {"message": "forbidden"}}))
    with pytest.raises(ProviderMissingKey):
        await p.complete(model="gemini-2.5-pro", prompt="hi")


@pytest.mark.asyncio
@respx.mock
async def test_rate_limit_maps() -> None:
    p = GoogleProvider(api_key="g-test")
    respx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    ).mock(return_value=httpx.Response(
        429, headers={"retry-after": "60"}, json={"error": {"message": "rate limit"}}
    ))
    with pytest.raises(ProviderRateLimit) as exc:
        await p.complete(model="gemini-2.5-pro", prompt="hi")
    assert exc.value.retry_after_seconds == 60
