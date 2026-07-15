import uuid

import pytest

from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for


async def test_mock_env_short_circuits(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    p = await build_provider_for(uuid.uuid4(), "anthropic")
    assert p.__class__.__name__ == "MockProvider"

async def test_missing_key_raises(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TEST_PROVIDER", raising=False)
    with pytest.raises(ProviderMissingKey):
        await build_provider_for(uuid.uuid4(), "anthropic")

async def test_stored_key_builds_real_provider(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TEST_PROVIDER", raising=False)
    from blogforge.keys import KeyVault
    u = uuid.uuid4()
    await KeyVault(u).set("anthropic", "sk-ant-real")
    p = await build_provider_for(u, "anthropic")
    assert p.__class__.__name__ == "AnthropicProvider"


async def test_unavailable_codex_cli_builds_keyless_provider_with_actionable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BLOGFORGE_TEST_PROVIDER", raising=False)
    monkeypatch.setattr("blogforge.llm.codex_cli.shutil.which", lambda _name: None)

    provider = await build_provider_for(uuid.uuid4(), "codex-cli")

    assert provider.__class__.__name__ == "CodexCliProvider"
    with pytest.raises(ProviderError, match="CLI was not found") as exc_info:
        await provider.complete(model="codex-default", prompt="Write")
    assert exc_info.value.code == "provider_error"
    assert exc_info.value.hint == "Install Codex CLI on the host where BlogForge runs."
