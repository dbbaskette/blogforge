from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_root_dev_mode_returns_placeholder(client: TestClient) -> None:
    """When no static bundle exists, root returns the dev placeholder."""
    r = client.get("/")
    assert r.status_code == 200
    assert "pencraft" in r.text.lower()
