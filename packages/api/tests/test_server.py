import pytest
from fastapi.testclient import TestClient

from blogforge.server import _build_info


def test_health_endpoint(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_build_info_reads_the_deploy_id(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "build_info.json").write_text(
        '{"version":"0.1.0","commit":"abc1234","built_at":"2026-07-02T00:00:00Z"}',
        encoding="utf-8",
    )
    monkeypatch.setenv("BLOGFORGE_STATIC_DIR", str(tmp_path))
    info = _build_info()
    assert info["commit"] == "abc1234"
    assert info["built_at"] == "2026-07-02T00:00:00Z"


def test_build_info_absent_is_empty(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    # No build_info.json (dev / tests) → health still reports just the semver.
    monkeypatch.setenv("BLOGFORGE_STATIC_DIR", str(tmp_path))
    assert _build_info() == {}


def test_root_dev_mode_returns_placeholder(client: TestClient) -> None:
    """When no static bundle exists, root returns the dev placeholder."""
    r = client.get("/")
    assert r.status_code == 200
    assert "blogforge" in r.text.lower()
