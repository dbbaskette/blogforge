"""The connector router is mounted into the main API app same-origin."""
from fastapi.testclient import TestClient

from pencraft.server import create_app


def test_linkedin_health_served_by_main_app():
    """With mount_linkedin (default True), /linkedin/* is on the main app."""
    app = create_app()
    with TestClient(app) as c:
        r = c.get("/linkedin/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


def test_linkedin_status_requires_auth_on_main_app():
    app = create_app()
    with TestClient(app) as c:
        # No session cookie → the shared get_current_user 401s.
        assert c.get("/linkedin/status").status_code == 401
