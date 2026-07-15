from __future__ import annotations

import asyncio
import json
import tempfile

import pytest

from blogforge.llm.codex_cli import CodexCliProvider, codex_available, codex_status
from blogforge.llm.exceptions import ProviderError


class FakeProcess:
    def __init__(
        self,
        *,
        stdout: bytes = b"",
        stderr: bytes = b"",
        returncode: int = 0,
        final: str | None = "Finished article",
    ) -> None:
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode
        self.final = final
        self.killed = False
        self.waited = False

    async def communicate(self, data: bytes | None = None) -> tuple[bytes, bytes]:
        self.input = data
        output_flag = (
            self.args.index("--output-last-message") + 1
            if "--output-last-message" in self.args
            else None
        )
        if self.final is not None and output_flag is not None:
            with open(self.args[output_flag], "w", encoding="utf-8") as f:
                f.write(self.final)
        return self.stdout, self.stderr

    def kill(self) -> None:
        self.killed = True

    async def wait(self) -> int:
        self.waited = True
        return self.returncode


@pytest.fixture
def cli(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "shutil.which", lambda command: "/usr/bin/codex" if command == "codex" else None
    )

    def install(proc: FakeProcess) -> FakeProcess:
        async def create(*args, **kwargs):
            assert args[:2] == ("/usr/bin/codex", "exec")
            assert "--ephemeral" in args
            assert ("--sandbox", "read-only") == (
                args[args.index("--sandbox")],
                args[args.index("--sandbox") + 1],
            )
            assert "--skip-git-repo-check" in args
            output_index = args.index("--output-last-message")
            output_path = args[output_index + 1]
            assert args[output_index : output_index + 2] == (
                "--output-last-message",
                output_path,
            )
            assert output_path.startswith(kwargs["cwd"])
            config_index = args.index("-c")
            assert args[config_index : config_index + 2] == ("-c", 'web_search="live"')
            assert "--model" not in args
            assert "-" == args[-1]
            assert kwargs["cwd"].startswith(tempfile.gettempdir())
            proc.args = args
            return proc

        monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
        return proc

    return install


def test_codex_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _: None)
    assert codex_available() is False
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")
    assert codex_available() is True


@pytest.mark.asyncio
async def test_lists_one_synthetic_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")
    models = await CodexCliProvider().list_models()
    assert [m.model_dump() for m in models] == [
        {
            "id": "codex-default",
            "label": "Codex default",
            "context_window": 200_000,
            "supports_streaming": False,
            "input_per_million_usd": None,
            "output_per_million_usd": None,
        }
    ]


@pytest.mark.asyncio
async def test_reads_only_final_message_and_sends_directive(cli) -> None:
    proc = cli(FakeProcess(stdout=b'{"type":"noisy jsonl"}\n'))
    response = await CodexCliProvider().complete(model="ignored", prompt="Write it")
    assert response.text == "Finished article"
    assert response.model == "codex-default"
    assert proc.input.endswith(b"\n\nWrite it")


@pytest.mark.asyncio
async def test_coerces_structured_output(cli) -> None:
    cli(FakeProcess(final='Here: ```json\n{"title": "Hi"}\n```'))
    schema = {"type": "object"}
    response = await CodexCliProvider().complete(
        model="anything", prompt="Write", json_schema=schema
    )
    assert json.loads(response.text) == {"title": "Hi"}


@pytest.mark.asyncio
async def test_nonzero_exit_prefers_stderr(cli) -> None:
    cli(FakeProcess(returncode=7, stdout=b"stdout detail", stderr=b"stderr detail"))
    with pytest.raises(ProviderError, match="stderr detail") as exc:
        await CodexCliProvider().complete(model="x", prompt="Write")
    assert "codex login status" in str(exc.value.hint)


@pytest.mark.asyncio
async def test_missing_final_output_is_an_error(cli) -> None:
    cli(FakeProcess(final=None))
    with pytest.raises(ProviderError, match="final message"):
        await CodexCliProvider().complete(model="x", prompt="Write")


@pytest.mark.asyncio
async def test_timeout_kills_and_reaps(cli, monkeypatch: pytest.MonkeyPatch) -> None:
    proc = cli(FakeProcess())

    async def timeout(awaitable, timeout):
        awaitable.close()
        raise TimeoutError

    monkeypatch.setattr(asyncio, "wait_for", timeout)
    with pytest.raises(ProviderError, match="codex exec timed out"):
        await CodexCliProvider().complete(model="x", prompt="Write")
    assert proc.killed and proc.waited


@pytest.mark.asyncio
async def test_status_not_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _: None)
    status = await codex_status()
    assert status["installed"] is False and status["authenticated"] is False


@pytest.mark.asyncio
async def test_status_login_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")
    proc = FakeProcess(returncode=1, stderr=b"Not logged in")

    async def create(*args, **kwargs):
        proc.args = args
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
    status = await codex_status()
    assert status["installed"] is True and status["authenticated"] is False
    assert "login" in str(status["resolve"]).lower()


@pytest.mark.asyncio
async def test_status_login_and_probe_succeed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")
    login = FakeProcess(stdout=b"Logged in")
    probe = FakeProcess(final="OK")
    calls = 0

    async def create(*args, **kwargs):
        nonlocal calls
        proc = login if calls == 0 else probe
        calls += 1
        proc.args = args
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
    status = await codex_status()
    assert status["installed"] is True and status["authenticated"] is True


@pytest.mark.asyncio
async def test_status_probe_timeout_has_retry_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")
    login = FakeProcess(stdout=b"Logged in")

    async def create(*args, **kwargs):
        login.args = args
        return login

    async def timed_out(*args, **kwargs):
        raise ProviderError("codex exec timed out.")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr(CodexCliProvider, "_run", timed_out)
    status = await codex_status(timeout=0.1)
    assert status["authenticated"] is False
    assert "timed out" in str(status["detail"]).lower()
    assert "refresh" in str(status["resolve"]).lower()
    resolution = str(status["resolve"]).lower()
    assert "cd /tmp" in resolution
    assert "codex exec --ephemeral" in resolution
    assert "--sandbox read-only" in resolution
    assert "--skip-git-repo-check" in resolution


@pytest.mark.asyncio
async def test_status_probe_usage_limit_is_actionable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")
    login = FakeProcess(stdout=b"Logged in")

    async def create(*args, **kwargs):
        login.args = args
        return login

    async def rate_limited(*args, **kwargs):
        raise ProviderError("Usage limit reached")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr(CodexCliProvider, "_run", rate_limited)
    status = await codex_status()
    assert status["authenticated"] is False
    assert "usage limit" in str(status["detail"]).lower()
    assert "reset" in str(status["resolve"]).lower()


@pytest.mark.asyncio
async def test_status_oserror_is_actionable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/codex")

    async def create(*args, **kwargs):
        raise OSError("cannot execute")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
    status = await codex_status()
    assert status["installed"] is True and status["authenticated"] is False
    assert "couldn't launch" in str(status["detail"]).lower()
    assert "codex login status" in str(status["resolve"]).lower()
