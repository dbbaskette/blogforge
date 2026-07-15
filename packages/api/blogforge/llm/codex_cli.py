"""LLM provider backed by the locally authenticated Codex CLI."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
from collections.abc import AsyncIterator

from blogforge.llm.base import LLMResponse, ModelInfo, StreamChunk, Usage
from blogforge.llm.exceptions import ProviderError

_TIMEOUT_SECONDS = 600
_MODEL_ID = "codex-default"
_ENGINE_DIRECTIVE = (
    "You are a content-generation engine embedded inside an application. "
    "Research the web whenever useful, including retrieving URLs named in the prompt. "
    "Output ONLY the requested content. Never add preamble, acknowledgements, "
    "planning, process notes, or commentary."
)


def codex_available() -> bool:
    return shutil.which("codex") is not None


def _coerce_json(text: str) -> str:
    fenced = re.search(r"```(?:json)?\s*\n(.*?)\n\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text.strip()


async def _terminate(proc: object) -> None:
    proc.kill()  # type: ignore[attr-defined]
    await proc.wait()  # type: ignore[attr-defined]


class CodexCliProvider:
    name = "codex-cli"

    def __init__(self, api_key: str = "") -> None:
        self._bin = shutil.which("codex")

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                id=_MODEL_ID,
                label="Codex default",
                context_window=200_000,
                supports_streaming=False,
            )
        ]

    async def _run(self, prompt: str, *, timeout: float = _TIMEOUT_SECONDS) -> str:
        if not self._bin:
            raise ProviderError(
                "The `codex` CLI was not found on PATH.",
                hint="Install Codex CLI on the host where BlogForge runs.",
            )
        with tempfile.TemporaryDirectory(prefix="blogforge-codex-") as workdir:
            output_path = os.path.join(workdir, "last-message.txt")
            args = [
                self._bin,
                "exec",
                "--ephemeral",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--output-last-message",
                output_path,
                "-c",
                'web_search="live"',
                "-",
            ]
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workdir,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(f"{_ENGINE_DIRECTIVE}\n\n{prompt}".encode()), timeout=timeout
                )
            except TimeoutError as exc:
                await _terminate(proc)
                raise ProviderError("codex exec timed out.") from exc
            except asyncio.CancelledError:
                await _terminate(proc)
                raise
            if proc.returncode != 0:
                err = stderr.decode("utf-8", "replace").strip()
                out = stdout.decode("utf-8", "replace").strip()
                detail = err or out or "(no output on stdout or stderr)"
                raise ProviderError(
                    f"codex exec exited {proc.returncode}: {detail[:600]}",
                    hint="Run `codex login status` in the same shell that launched BlogForge.",
                )
            try:
                with open(output_path, encoding="utf-8") as output:
                    text = output.read()
            except OSError as exc:
                raise ProviderError("codex exec did not write a final message.") from exc
            if not text.strip():
                raise ProviderError("codex exec returned an empty final message.")
            return text

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        if json_schema is not None:
            prompt = (
                f"{prompt}\n\nIMPORTANT: Respond with ONLY valid JSON matching this schema "
                "— no prose, no markdown fences:\n"
                f"{json.dumps(json_schema)}"
            )
        text = await self._run(prompt)
        if json_schema is not None:
            text = _coerce_json(text)
        return LLMResponse(
            text=text, input_tokens=0, output_tokens=0, model=_MODEL_ID, finish_reason="stop"
        )

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        response = await self.complete(model=model, prompt=prompt)
        yield StreamChunk(delta=response.text)
        yield StreamChunk(usage=Usage(input_tokens=0, output_tokens=0, finish_reason="stop"))


def _status_failure(detail: str, resolve: str) -> dict[str, object]:
    return {"installed": True, "authenticated": False, "detail": detail, "resolve": resolve}


async def codex_status(timeout: float = 20.0) -> dict[str, object]:
    """Return CLI installation/authentication status without raising."""
    binary = shutil.which("codex")
    if not binary:
        return {
            "installed": False,
            "authenticated": False,
            "detail": "The `codex` CLI isn't on PATH where BlogForge runs.",
            "resolve": "Install Codex CLI, or run BlogForge on a host where `codex` is on PATH.",
        }
    try:
        proc = await asyncio.create_subprocess_exec(
            binary,
            "login",
            "status",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            await _terminate(proc)
            return _status_failure(
                "The `codex login status` check timed out.",
                "Try Refresh, then run `codex login status` in the server's shell.",
            )
        blob = (stderr or stdout).decode("utf-8", "replace").strip()
        if proc.returncode != 0:
            return _status_failure(
                blob[:300] or "The Codex CLI is installed but not logged in.",
                "Run `codex login` in the terminal where BlogForge runs, then Refresh.",
            )
        provider = CodexCliProvider()
        try:
            await provider._run("Reply with the single word OK.", timeout=timeout)
        except ProviderError as exc:
            low = str(exc).lower()
            if "timed out" in low or "timeout" in low:
                return _status_failure(
                    "The Codex CLI generation probe timed out.",
                    "Try Refresh, or run `printf 'OK' | codex exec -` in the server's shell.",
                )
            if "rate" in low or "usage limit" in low or "quota" in low:
                return _status_failure(
                    "The Codex CLI is authenticated, but its usage limit was reached.",
                    "Wait for the usage limit to reset, then Refresh.",
                )
            return _status_failure(
                str(exc),
                "Run `codex login status` and `codex login` in the server's shell, then Refresh.",
            )
        return {
            "installed": True,
            "authenticated": True,
            "detail": "The Codex CLI is installed and logged in.",
            "resolve": "",
        }
    except OSError as exc:
        return _status_failure(
            f"Couldn't launch the Codex CLI ({exc.__class__.__name__}).",
            "Check the Codex CLI installation and run `codex login status`, then Refresh.",
        )
    except Exception as exc:
        return _status_failure(
            f"The Codex CLI status check failed ({exc.__class__.__name__}).",
            "Run `codex login status` in the server's shell, then Refresh.",
        )
