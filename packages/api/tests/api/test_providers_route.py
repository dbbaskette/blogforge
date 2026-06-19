"""GET /api/providers — availability and model listing.

NOTE: The admin-global / myvoice-config-based tests have been removed as part of
the per-user keys migration (Task 4/5). The route is being updated in Task 5 to
use per-user key lookup; the unknown-provider 404 test is preserved as it remains
correct.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

import pytest

from blogforge.server import create_app


@pytest.fixture
def anon_client(tmp_path, monkeypatch):
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(tmp_path / "nonexistent.yaml"))
    monkeypatch.setenv("BLOGFORGE_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_list_models_unknown_provider_404(anon_client: TestClient) -> None:
    r = anon_client.get("/api/providers/nope/models")
    assert r.status_code == 404
