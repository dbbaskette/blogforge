"""POST /api/drafts/{id}/revise — holistic whole-draft revision."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import pytest_asyncio
import yaml

from tests.conftest import _seed_approved_user, _signed_client

_MYVOICE_DAN = Path("/Users/dbbaskette/Projects/myvoice/packs/dan")


@pytest_asyncio.fixture
async def revise_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    if not _MYVOICE_DAN.exists():
        pytest.skip("requires myvoice dan pack")
    packs_root = tmp_path / "packs"
    packs_root.mkdir()
    shutil.copytree(_MYVOICE_DAN, packs_root / "dan")
    cfg = tmp_path / "myvoice_config.yaml"
    cfg.write_text(yaml.safe_dump({"providers": {"anthropic": {"api_key": "sk-mock"}}}))
    monkeypatch.setenv("MYVOICE_PACKS_ROOT", str(packs_root))
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(cfg))
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "Revised body here.")

    uid = await _seed_approved_user()
    with _signed_client(uid) as c:
        yield c


def _seed_written_draft(client, *, write: bool = True) -> str:
    created = client.post(
        "/api/drafts",
        json={"topic": "AI", "pack_slug": "dan", "provider": "anthropic", "model": "mock-1"},
    ).json()
    created["outline"] = {
        "opening_hook": "Hook.",
        "sections": [
            {"id": "s1", "title": "First", "brief": "b1"},
            {"id": "s2", "title": "Second", "brief": "b2"},
        ],
        "estimated_words": 800,
    }
    status = "ready" if write else "empty"
    body = "Original prose for the section." if write else ""
    created["sections"] = [
        {
            "id": "s1", "title": "First", "brief": "b1",
            "content_md": body, "status": status, "word_count": len(body.split()),
        },
        {
            "id": "s2", "title": "Second", "brief": "b2",
            "content_md": body, "status": status, "word_count": len(body.split()),
        },
    ]
    created["stage"] = "sections"
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]


def _drain(client, job_id: str) -> str:
    with client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        return b"".join(resp.iter_bytes()).decode()


async def test_revise_rewrites_every_written_section(revise_client) -> None:
    did = _seed_written_draft(revise_client)
    r = revise_client.post(f"/api/drafts/{did}/revise", json={"instruction": "tighten throughout"})
    assert r.status_code == 202
    assert '"type":"complete"' in _drain(revise_client, r.json()["job_id"])

    final = revise_client.get(f"/api/drafts/{did}").json()
    assert all(s["content_md"].strip() == "Revised body here." for s in final["sections"])
    assert all(s["status"] == "ready" for s in final["sections"])


async def test_revise_snapshots_prior_prose(revise_client) -> None:
    did = _seed_written_draft(revise_client)
    r = revise_client.post(f"/api/drafts/{did}/revise", json={"instruction": "smooth transitions"})
    _drain(revise_client, r.json()["job_id"])

    versions = revise_client.get(f"/api/drafts/{did}/sections/s1/versions").json()
    assert any(v["content_md"] == "Original prose for the section." for v in versions)


async def test_revise_nothing_written_409(revise_client) -> None:
    did = _seed_written_draft(revise_client, write=False)
    r = revise_client.post(f"/api/drafts/{did}/revise", json={"instruction": "do something"})
    assert r.status_code == 409
    assert r.json()["detail"]["error"]["code"] == "nothing_to_revise"


async def test_revise_requires_instruction_422(revise_client) -> None:
    did = _seed_written_draft(revise_client)
    blank = revise_client.post(f"/api/drafts/{did}/revise", json={"instruction": ""})
    assert blank.status_code == 422
    missing = revise_client.post(f"/api/drafts/{did}/revise", json={})
    assert missing.status_code == 422


async def test_revise_unknown_draft_404(revise_client) -> None:
    from uuid import uuid4

    r = revise_client.post(f"/api/drafts/{uuid4()}/revise", json={"instruction": "x"})
    assert r.status_code == 404
