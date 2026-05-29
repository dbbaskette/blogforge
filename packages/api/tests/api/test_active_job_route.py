"""GET /api/drafts/{id}/active-job — resume-watching discovery."""
from __future__ import annotations


def _idea() -> dict[str, object]:
    return {"topic": "T", "pack_slug": "dan", "provider": "anthropic", "model": "m"}


async def test_active_job_null_when_idle(authed_client) -> None:
    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]
    r = client.get(f"/api/drafts/{did}/active-job")
    assert r.status_code == 200
    assert r.json()["job_id"] is None


async def test_active_job_unknown_draft_404(authed_client) -> None:
    from uuid import uuid4

    client, _ = authed_client
    assert client.get(f"/api/drafts/{uuid4()}/active-job").status_code == 404


async def test_active_job_scoped_per_user(authed_client) -> None:
    from tests.conftest import _seed_approved_user, _signed_client

    client, _ = authed_client
    did = client.post("/api/drafts", json=_idea()).json()["id"]

    other_id = await _seed_approved_user(email="active-job-other@user.com")
    with _signed_client(other_id) as other:
        # Another user can't probe this draft's job state.
        assert other.get(f"/api/drafts/{did}/active-job").status_code == 404
