"""Claude Code CLI provider — generate via `claude -p` instead of the HTTP API.

Shells out to the locally-installed, logged-in `claude` binary in headless
print mode. This uses the user's Claude subscription (no API key) and lets the
model research with web search while it writes. It implements the same
LLMProvider interface as the HTTP providers, so document generation, inline
edits, repurposing, headlines, outline, and claims all route through it
unchanged.

Requires the API process to run where `claude` is on PATH and authenticated
(i.e. on the host, not the slim container).
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import tempfile
from collections.abc import AsyncIterator
from typing import Any

from blogforge.llm.base import LLMResponse, ModelInfo, StreamChunk, Usage
from blogforge.llm.exceptions import ProviderError
from blogforge.llm.rates import models_for

# Claude model aliases the CLI accepts for --model.
_FALLBACK_MODELS = ("opus", "sonnet", "haiku")
# Tools Claude may use while writing (web search on, per product decision).
_ALLOWED_TOOLS = ("WebSearch", "WebFetch")
_TIMEOUT_SECONDS = 600
# `claude -p` is Claude Code (a conversational assistant), so by default it
# wraps replies in preamble ("Proceeding to the output…") and process notes.
# This system directive forces it to behave like a raw generation engine.
_ENGINE_DIRECTIVE = (
    "You are a content-generation engine embedded inside an application. Output "
    "ONLY the requested content. Never add preamble, acknowledgements, "
    "meta-commentary, or notes about your process or the prompt. Do not say what "
    "you are about to do. Begin immediately with the content itself and stop when "
    "it ends."
)


def claude_available() -> bool:
    return shutil.which("claude") is not None


def _coerce_json(text: str) -> str:
    """Best-effort: pull a JSON object out of the model's reply (strip fences /
    surrounding prose) so callers can json.loads / model_validate_json it."""
    fenced = re.search(r"```(?:json)?\s*\n(.*?)\n\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text.strip()


class ClaudeCliProvider:
    name = "claude-cli"

    def __init__(self, api_key: str = "") -> None:
        # No key needed — the CLI carries its own (subscription) auth.
        self._bin = shutil.which("claude")

    async def list_models(self) -> list[ModelInfo]:
        rates = models_for("claude-cli")
        if rates:
            return [
                ModelInfo(
                    id=mid,
                    label=str(rate.get("label", mid)),
                    context_window=int(rate.get("context_window", 200_000)),
                    supports_streaming=False,
                    input_per_million_usd=None,
                    output_per_million_usd=None,
                )
                for mid, rate in rates.items()
            ]
        return [
            ModelInfo(id=m, label=f"Claude {m.capitalize()}", context_window=200_000,
                      supports_streaming=False)
            for m in _FALLBACK_MODELS
        ]

    async def _run(self, model: str, prompt: str) -> dict[str, Any]:
        if not self._bin:
            raise ProviderError(
                "The `claude` CLI was not found on PATH.",
                hint="Run BlogForge on a host where Claude Code is installed and logged in.",
            )
        args = [
            self._bin, "-p",
            "--output-format", "json",
            "--no-session-persistence",
            "--append-system-prompt", _ENGINE_DIRECTIVE,
            "--model", model or "sonnet",
            "--allowed-tools", *_ALLOWED_TOOLS,
        ]
        # Run in a throwaway dir so generation never inherits BlogForge's own
        # CLAUDE.md / .claude config (auth still resolves from $HOME).
        workdir = tempfile.mkdtemp(prefix="blogforge-claude-")
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workdir,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(prompt.encode("utf-8")), timeout=_TIMEOUT_SECONDS
                )
            except TimeoutError as e:
                proc.kill()
                raise ProviderError("claude -p timed out.") from e
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

        if proc.returncode != 0:
            msg = stderr.decode("utf-8", "replace").strip() or "claude -p failed."
            raise ProviderError(f"claude -p exited {proc.returncode}: {msg[:400]}")
        try:
            data: dict[str, Any] = json.loads(stdout.decode("utf-8", "replace"))
        except json.JSONDecodeError as e:
            raise ProviderError("claude -p returned non-JSON output.") from e
        if data.get("is_error"):
            raise ProviderError(f"claude -p error: {str(data.get('result'))[:400]}")
        return data

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        p = prompt
        if json_schema is not None:
            p = (
                f"{prompt}\n\nIMPORTANT: Respond with ONLY valid JSON matching this schema "
                "— no prose, no markdown fences:\n"
                f"{json.dumps(json_schema)}"
            )
        data = await self._run(model, p)
        text = str(data.get("result", ""))
        if json_schema is not None:
            text = _coerce_json(text)
        usage = data.get("usage") or {}
        return LLMResponse(
            text=text,
            input_tokens=int(usage.get("input_tokens", 0) or 0),
            output_tokens=int(usage.get("output_tokens", 0) or 0),
            model=model,
            finish_reason="stop",
        )

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        # The CLI can stream (stream-json), but a one-shot is simpler and the
        # bulk path is single-pass complete() anyway. Emit the full text once.
        resp = await self.complete(model=model, prompt=prompt)
        yield StreamChunk(delta=resp.text)
        yield StreamChunk(
            usage=Usage(
                input_tokens=resp.input_tokens,
                output_tokens=resp.output_tokens,
                finish_reason="stop",
            )
        )
