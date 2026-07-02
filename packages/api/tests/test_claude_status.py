"""Claude CLI live status probe — used by the Settings card to report whether
the keyless CLI provider is installed and logged in."""

from __future__ import annotations

import pytest

from blogforge.llm.claude_cli import _cli_auth_failure, claude_status


async def test_status_not_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("blogforge.llm.claude_cli.shutil.which", lambda _bin: None)
    s = await claude_status()
    assert s["installed"] is False
    assert s["authenticated"] is False
    assert "PATH" in str(s["detail"])


def test_auth_failure_recognizes_login_errors() -> None:
    for blob in (
        "API Error: 401 Invalid authentication credentials",
        "Not logged in · Please run /login",
        "please authenticate first",
    ):
        s = _cli_auth_failure(blob)
        assert s == {
            "installed": True,
            "authenticated": False,
            "detail": "The Claude CLI is installed but not logged in.",
            "resolve": "Run `claude /login` in the terminal where BlogForge runs, then Refresh.",
        }


def test_auth_failure_surfaces_unknown_errors_verbatim() -> None:
    s = _cli_auth_failure("some unexpected failure blob")
    assert s["authenticated"] is False
    assert "some unexpected failure blob" in str(s["detail"])


async def test_endpoint_returns_status(authed_client, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_status() -> dict[str, object]:
        return {"installed": True, "authenticated": True, "detail": "ok", "resolve": ""}

    monkeypatch.setattr("blogforge.llm.claude_cli.claude_status", fake_status)
    client, _ = authed_client
    r = client.get("/api/providers/claude-cli/status")
    assert r.status_code == 200
    assert r.json() == {"installed": True, "authenticated": True, "detail": "ok", "resolve": ""}
