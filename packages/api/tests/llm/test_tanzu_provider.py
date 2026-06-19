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
