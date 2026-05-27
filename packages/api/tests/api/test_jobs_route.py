import pytest


@pytest.mark.asyncio
async def test_job_not_found(tmp_path, monkeypatch):
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    from fastapi.testclient import TestClient

    from pencraft.server import create_app

    app = create_app()
    with TestClient(app) as c:
        r = c.get("/api/jobs/nope")
        assert r.status_code == 404
