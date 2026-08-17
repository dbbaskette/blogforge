"""POST /api/drafts/{id}/revise — holistic whole-draft revision."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import pytest_asyncio
import yaml

from blogforge.jobs.models import JobType
from blogforge.llm.exceptions import ProviderMissingKey
from tests.conftest import _seed_approved_user, _signed_client

_STYLEPACK = {
    "spec_version": "1.0",
    "pack": {"slug": "dan", "name": "Dan", "version": "1.0", "author": "Dan"},
    "persona": {"identity": "A direct writer", "one_line": "Writes clearly."},
}


@pytest_asyncio.fixture
async def revise_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    packs_root = tmp_path / "packs"
    pack_root = packs_root / "dan"
    pack_root.mkdir(parents=True)
    (pack_root / "stylepack.yaml").write_text(yaml.safe_dump(_STYLEPACK), encoding="utf-8")
    (pack_root / "style-guide.md").write_text("Write clearly.\n", encoding="utf-8")
    cfg = tmp_path / "myvoice_config.yaml"
    cfg.write_text(
        yaml.safe_dump({"providers": {"anthropic": {"api_key": "sk-mock"}}}),
        encoding="utf-8",
    )
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
        json={
            "topic": "AI",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "mock-1",
            "use_voice_profile": False,
        },
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
            "id": "s1",
            "title": "First",
            "brief": "b1",
            "content_md": body,
            "status": status,
            "word_count": len(body.split()),
        },
        {
            "id": "s2",
            "title": "Second",
            "brief": "b2",
            "content_md": body,
            "status": status,
            "word_count": len(body.split()),
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


async def test_revise_persists_provider_recovery_metadata(revise_client, monkeypatch) -> None:
    async def fail_provider_resolution(*args, **kwargs):
        raise ProviderMissingKey("anthropic")

    monkeypatch.setattr("blogforge.api.revise.build_provider_for", fail_provider_resolution)
    did = _seed_written_draft(revise_client)

    response = revise_client.post(
        f"/api/drafts/{did}/revise", json={"instruction": "tighten throughout"}
    )
    body = _drain(revise_client, response.json()["job_id"])

    final = revise_client.get(f"/api/drafts/{did}").json()
    persisted = json.loads(final["sections"][0]["last_error"])
    assert all(s["content_md"] == "Original prose for the section." for s in final["sections"])
    assert persisted["version"] == 1
    assert persisted["code"] == "provider_missing_key"
    assert persisted["message"].startswith("No API key configured")
    assert '"code":"provider_missing_key"' in body


async def test_section_regenerate_persists_provider_recovery_metadata(
    revise_client, monkeypatch
) -> None:
    async def fail_provider_resolution(*args, **kwargs):
        raise ProviderMissingKey("anthropic")

    monkeypatch.setattr("blogforge.api.section.build_provider_for", fail_provider_resolution)
    did = _seed_written_draft(revise_client)

    response = revise_client.post(
        f"/api/drafts/{did}/sections/s1/regenerate",
        json={"instruction": "tighten this section"},
    )
    body = _drain(revise_client, response.json()["job_id"])

    final = revise_client.get(f"/api/drafts/{did}").json()
    persisted = json.loads(final["sections"][0]["last_error"])
    assert final["sections"][0]["content_md"] == "Original prose for the section."
    assert persisted["version"] == 1
    assert persisted["code"] == "provider_missing_key"
    assert persisted["hint"] == "Add the key in Settings."
    assert '"code":"provider_missing_key"' in body


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("revise", {"instruction": "tighten throughout"}),
        ("sections/s1/regenerate", {"instruction": "tighten this section"}),
    ],
)
async def test_generation_routes_reject_a_second_active_job(
    revise_client, path: str, payload: dict[str, str]
) -> None:
    did = _seed_written_draft(revise_client)
    active = await revise_client.app.state.job_registry.create(JobType.REVISE_DRAFT, draft_id=did)

    response = revise_client.post(f"/api/drafts/{did}/{path}", json=payload)

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == {
        "code": "generation_already_active",
        "message": "A generation job is already active for this draft.",
        "job_id": active.id,
    }


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
