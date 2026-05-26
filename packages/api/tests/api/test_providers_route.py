"""GET /api/providers — reads myvoice config, never leaks keys."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from pencraft.server import create_app


@pytest.fixture
def client_with_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    cfg_path = tmp_path / "myvoice_config.yaml"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "providers": {
                    "anthropic": {"api_key": "sk-ant-test"},
                    "openai": {"api_key": ""},
                    "google": {"api_key": "g-test"},
                }
            }
        )
    )
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(cfg_path))
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_providers_returns_availability_only(client_with_keys: TestClient) -> None:
    r = client_with_keys.get("/api/providers")
    assert r.status_code == 200
    body = r.json()
    assert body == {"anthropic": True, "openai": False, "google": True}
    # No key leak
    assert "sk-ant-test" not in r.text
    assert "g-test" not in r.text


def test_providers_missing_config_returns_empty_map(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(tmp_path / "nonexistent.yaml"))
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app) as c:
        r = c.get("/api/providers")
    assert r.status_code == 200
    assert r.json() == {"anthropic": False, "openai": False, "google": False}


def test_list_models_400_when_no_key(client_with_keys: TestClient) -> None:
    r = client_with_keys.get("/api/providers/openai/models")
    assert r.status_code == 400
    assert r.json()["detail"]["error"]["code"] == "provider_missing_key"


def test_list_models_unknown_provider_404(client_with_keys: TestClient) -> None:
    r = client_with_keys.get("/api/providers/nope/models")
    assert r.status_code == 404
