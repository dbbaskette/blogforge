from blogforge.llm.tanzu import TanzuProvider


async def test_list_models_returns_configured(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TANZU_API_BASE", "https://g/v1")
    monkeypatch.setenv("BLOGFORGE_TANZU_API_KEY", "k")
    monkeypatch.setenv("BLOGFORGE_TANZU_MODELS", "modelA,modelB")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    p = TanzuProvider.from_settings()
    ids = [m.id for m in await p.list_models()]
    assert ids == ["modelA", "modelB"]
    assert all("nomic" not in i for i in ids)


def test_verify_ssl_flows_from_settings(monkeypatch) -> None:
    # The bound GenAI gateway is self-signed; from_settings must honor the
    # tanzu_verify_ssl flag so the httpx client skips cert verification.
    monkeypatch.setenv("BLOGFORGE_TANZU_API_BASE", "https://g/v1")
    monkeypatch.setenv("BLOGFORGE_TANZU_API_KEY", "k")
    monkeypatch.setenv("BLOGFORGE_TANZU_VERIFY_SSL", "false")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    assert TanzuProvider.from_settings()._verify_ssl is False

    monkeypatch.setenv("BLOGFORGE_TANZU_VERIFY_SSL", "true")
    s.get_settings.cache_clear()
    assert TanzuProvider.from_settings()._verify_ssl is True


def test_default_model_for_tanzu_uses_first_configured(monkeypatch) -> None:
    # `tanzu` must NOT fall back to the anthropic default (the GenAI gateway
    # doesn't serve `claude-sonnet-4-6` → 404).
    monkeypatch.setenv("BLOGFORGE_TANZU_MODELS", "openai/gpt-oss-120b,google/gemma-4-31B-it")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    from blogforge.api.voice import _default_model
    assert _default_model("tanzu") == "openai/gpt-oss-120b"
    assert _default_model("anthropic") == "claude-sonnet-4-6"
