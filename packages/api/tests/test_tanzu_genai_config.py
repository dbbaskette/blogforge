import json
import os
from blogforge.config.tanzu import apply_vcap_services


def test_genai_binding_sets_tanzu_env(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.delenv("BLOGFORGE_TANZU_API_KEY", raising=False)
    # Real ndc shape: the `ai-models` offering, instance named `blogforge-ai`.
    monkeypatch.setenv("VCAP_SERVICES", json.dumps({
        "ai-models": [{
            "name": "blogforge-ai",
            "credentials": {"api_base": "https://genai.example/v1", "api_key": "tz-secret"},
        }]
    }))
    apply_vcap_services()
    assert os.environ["BLOGFORGE_TANZU_API_BASE"] == "https://genai.example/v1"
    assert os.environ["BLOGFORGE_TANZU_API_KEY"] == "tz-secret"


def test_no_binding_is_noop(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.setenv("VCAP_SERVICES", json.dumps({"postgresql": []}))
    apply_vcap_services()
    assert "BLOGFORGE_TANZU_API_BASE" not in os.environ
