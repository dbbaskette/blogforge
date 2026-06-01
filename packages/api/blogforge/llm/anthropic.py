"""Anthropic Messages API adapter — uses httpx directly (not the SDK) for simpler streaming."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Literal

import httpx

from blogforge.llm.base import LLMResponse, ModelInfo, StreamChunk, Usage
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey, ProviderRateLimit
from blogforge.llm.rates import models_for

_BASE_URL = "https://api.anthropic.com/v1"
_API_VERSION = "2023-06-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ProviderMissingKey("anthropic")
        self._api_key = api_key
        self._headers = {
            "x-api-key": api_key,
            "anthropic-version": _API_VERSION,
            "content-type": "application/json",
        }

    async def list_models(self) -> list[ModelInfo]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{_BASE_URL}/models", headers=self._headers)
        if r.status_code == 401:
            raise ProviderMissingKey("anthropic")
        if r.status_code >= 400:
            raise ProviderError(f"anthropic list_models {r.status_code}: {r.text}")
        rates = models_for("anthropic")
        result: list[ModelInfo] = []
        for m in r.json().get("data", []):
            rate = rates.get(m["id"])
            result.append(ModelInfo(
                id=m["id"],
                label=(rate["label"] if rate else None) or m.get("display_name") or m["id"],
                context_window=int(rate["context_window"] if rate else 200_000),
                supports_streaming=bool(rate["supports_streaming"] if rate else True),
                input_per_million_usd=float(rate["input_per_million_usd"]) if rate else None,
                output_per_million_usd=float(rate["output_per_million_usd"]) if rate else None,
            ))
        return result

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        return await self._complete_with_retry(model=model, prompt=prompt, json_schema=json_schema)

    async def _complete_with_retry(
        self,
        *,
        model: str,
        prompt: str,
        json_schema: dict[str, object] | None,
        attempt: int = 0,
    ) -> LLMResponse:
        body: dict[str, object] = {
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        if json_schema is not None:
            body["tools"] = [
                {"name": "record_analysis", "input_schema": json_schema}
            ]
            body["tool_choice"] = {"type": "tool", "name": "record_analysis"}
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(f"{_BASE_URL}/messages", headers=self._headers, json=body)
        self._raise_for_status(r)
        data = r.json()
        usage = data.get("usage", {})
        in_tok = int(usage.get("input_tokens", 0))
        out_tok = int(usage.get("output_tokens", 0))
        finish = _map_stop_reason(data.get("stop_reason"))

        if json_schema is None:
            text = "".join(
                b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
            )
            return LLMResponse(
                text=text, input_tokens=in_tok, output_tokens=out_tok,
                model=data.get("model", model), finish_reason=finish,
            )

        # Structured-output path: extract tool_use input
        tool_block = next(
            (b for b in data.get("content", []) if b.get("type") == "tool_use"),
            None,
        )
        if tool_block is None:
            if attempt == 0:
                # One retry with corrective hint appended.
                hint = (
                    "\n\nYour previous response did not call the `record_analysis` tool. "
                    "You MUST call the tool with valid arguments matching the schema."
                )
                return await self._complete_with_retry(
                    model=model, prompt=prompt + hint, json_schema=json_schema, attempt=1,
                )
            raise ProviderError(
                "Anthropic did not emit tool_use after retry.",
            )._with_code("analyze_invalid_json")
        return LLMResponse(
            text=json.dumps(tool_block.get("input", {})),
            input_tokens=in_tok, output_tokens=out_tok,
            model=data.get("model", model), finish_reason=finish,
        )

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        body = {
            "model": model,
            "max_tokens": 4096,
            "stream": True,
            "messages": [{"role": "user", "content": prompt}],
        }
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST", f"{_BASE_URL}/messages", headers=self._headers, json=body
            ) as r:
                if r.status_code >= 400:
                    body_text = await r.aread()
                    self._raise_for_response(r.status_code, body_text.decode(), r.headers)
                input_tokens = 0
                output_tokens = 0
                finish_reason: Literal["stop", "length", "error"] = "stop"
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload:
                        continue
                    evt = json.loads(payload)
                    t = evt.get("type")
                    if t == "message_start":
                        msg_usage = evt.get("message", {}).get("usage", {})
                        input_tokens = msg_usage.get("input_tokens", 0)
                    elif t == "content_block_delta":
                        delta = evt.get("delta", {}).get("text", "")
                        if delta:
                            yield StreamChunk(delta=delta)
                    elif t == "message_delta":
                        usage = evt.get("usage", {})
                        if "output_tokens" in usage:
                            output_tokens = usage["output_tokens"]
                        stop = evt.get("delta", {}).get("stop_reason")
                        if stop:
                            finish_reason = _map_stop_reason(stop)
                yield StreamChunk(
                    usage=Usage(
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        finish_reason=finish_reason,
                    )
                )

    def _raise_for_status(self, r: httpx.Response) -> None:
        if r.status_code < 400:
            return
        self._raise_for_response(r.status_code, r.text, r.headers)

    def _raise_for_response(self, status: int, body: str, headers: httpx.Headers) -> None:
        if status == 401:
            raise ProviderMissingKey("anthropic")
        if status == 429:
            retry = headers.get("retry-after")
            raise ProviderRateLimit(
                f"Anthropic rate limit: {body[:200]}",
                retry_after_seconds=int(retry) if retry and retry.isdigit() else None,
            )
        raise ProviderError(f"anthropic {status}: {body[:500]}")


def _map_stop_reason(reason: str | None) -> Literal["stop", "length", "error"]:
    if reason in (None, "end_turn", "stop_sequence"):
        return "stop"
    if reason == "max_tokens":
        return "length"
    return "error"
