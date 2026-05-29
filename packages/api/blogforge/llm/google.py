"""Google Gemini adapter (Generative Language API). Uses ?key=<api_key>."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Literal

import httpx

from blogforge.llm.base import LLMResponse, ModelInfo, StreamChunk, Usage
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey, ProviderRateLimit
from blogforge.llm.rates import models_for

_BASE = "https://generativelanguage.googleapis.com/v1beta"


def to_google_schema(schema: dict[str, object]) -> dict[str, object]:
    """Convert a JSON Schema dict to Google's response_schema dialect (subset).

    Drops $schema/$id/$ref + additionalProperties. Converts {type:["string","null"]}
    to {type:"string", nullable:True}.
    """
    if not isinstance(schema, dict):
        return schema
    out: dict[str, object] = {}
    for k, v in schema.items():
        if k in ("$schema", "$id", "$ref", "additionalProperties"):
            continue
        if k == "type" and isinstance(v, list):
            non_null = [t for t in v if t != "null"]
            if len(non_null) == 1 and "null" in v:
                out["type"] = non_null[0]
                out["nullable"] = True
                continue
            out[k] = v
            continue
        if isinstance(v, dict):
            out[k] = to_google_schema(v)
        elif isinstance(v, list):
            out[k] = [to_google_schema(x) if isinstance(x, dict) else x for x in v]
        else:
            out[k] = v
    return out


class GoogleProvider:
    name = "google"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ProviderMissingKey("google")
        self._api_key = api_key

    async def list_models(self) -> list[ModelInfo]:
        # Curated allowlist from rates.yaml — google's public list endpoint is messy
        # and does not work cleanly for all user key types.
        result: list[ModelInfo] = []
        for mid, rate in models_for("google").items():
            result.append(ModelInfo(
                id=mid,
                label=rate["label"],
                context_window=int(rate["context_window"]),
                supports_streaming=bool(rate["supports_streaming"]),
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
        url = f"{_BASE}/models/{model}:generateContent"
        body: dict[str, object] = {"contents": [{"parts": [{"text": prompt}]}]}
        if json_schema is not None:
            body["generationConfig"] = {
                "response_mime_type": "application/json",
                "response_schema": to_google_schema(json_schema),
            }
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(url, params={"key": self._api_key}, json=body)
        self._raise_for_status(r)
        data = r.json()
        candidate = (data.get("candidates") or [{}])[0]
        parts = candidate.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)
        usage = data.get("usageMetadata", {})
        in_tok = int(usage.get("promptTokenCount", 0))
        out_tok = int(usage.get("candidatesTokenCount", 0))
        finish = _map_finish(candidate.get("finishReason"))

        if json_schema is not None:
            try:
                json.loads(text)
            except json.JSONDecodeError:
                if attempt == 0:
                    hint = (
                        "\n\nYour previous response was not valid JSON. "
                        "Re-emit ONLY a JSON object matching the schema."
                    )
                    return await self._complete_with_retry(
                        model=model, prompt=prompt + hint,
                        json_schema=json_schema, attempt=1,
                    )
                raise ProviderError("Google returned invalid JSON after retry.")._with_code(
                    "analyze_invalid_json"
                ) from None
        return LLMResponse(
            text=text, input_tokens=in_tok, output_tokens=out_tok,
            model=model, finish_reason=finish,
        )

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        url = f"{_BASE}/models/{model}:streamGenerateContent"
        body: dict[str, object] = {"contents": [{"parts": [{"text": prompt}]}]}
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST", url, params={"key": self._api_key, "alt": "sse"}, json=body
            ) as r:
                if r.status_code >= 400:
                    body_text = await r.aread()
                    self._raise_for_response(r.status_code, body_text.decode(), r.headers)
                in_tok = 0
                out_tok = 0
                finish: Literal["stop", "length", "error"] = "stop"
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload:
                        continue
                    evt = json.loads(payload)
                    candidates = evt.get("candidates", [])
                    if candidates:
                        c = candidates[0]
                        for part in c.get("content", {}).get("parts", []):
                            delta = part.get("text", "")
                            if delta:
                                yield StreamChunk(delta=delta)
                        fr = c.get("finishReason")
                        if fr:
                            finish = _map_finish(fr)
                    usage_meta = evt.get("usageMetadata")
                    if usage_meta:
                        in_tok = int(usage_meta.get("promptTokenCount", in_tok))
                        out_tok = int(usage_meta.get("candidatesTokenCount", out_tok))
                yield StreamChunk(
                    usage=Usage(input_tokens=in_tok, output_tokens=out_tok, finish_reason=finish)
                )

    def _raise_for_status(self, r: httpx.Response) -> None:
        if r.status_code < 400:
            return
        self._raise_for_response(r.status_code, r.text, r.headers)

    def _raise_for_response(self, status: int, body: str, headers: httpx.Headers) -> None:
        if status in (401, 403):
            raise ProviderMissingKey("google")
        if status == 429:
            retry = headers.get("retry-after")
            raise ProviderRateLimit(
                f"Google rate limit: {body[:200]}",
                retry_after_seconds=int(retry) if retry and retry.isdigit() else None,
            )
        raise ProviderError(f"google {status}: {body[:500]}")


def _map_finish(reason: str | None) -> Literal["stop", "length", "error"]:
    if reason in (None, "STOP", "FINISH_REASON_UNSPECIFIED"):
        return "stop"
    if reason == "MAX_TOKENS":
        return "length"
    return "error"
