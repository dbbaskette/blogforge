"""POST /api/drafts/{id}/expand."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
import yaml

from blogforge.api import expand as expand_api
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.jobs.models import JobType
from blogforge.jobs.registry import JobRegistry
from blogforge.llm.exceptions import ProviderMissingKey
from tests.conftest import _seed_approved_user, _signed_client

_STYLEPACK = {
    "spec_version": "1.0",
    "pack": {"slug": "dan", "name": "Dan", "version": "1.0", "author": "Dan"},
    "persona": {"identity": "A direct writer", "one_line": "Writes clearly."},
}


@pytest_asyncio.fixture
async def expand_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
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
    # Single-pass expand calls provider.complete() once for the whole document,
    # then splits by H2 heading — so the mock must return headed markdown that
    # matches the seeded outline's section titles ("First", "Second").
    monkeypatch.setenv(
        "BLOGFORGE_MOCK_OUTPUT",
        "## First\nFirst section body.\n\n## Second\nSecond section body.\n",
    )

    uid = await _seed_approved_user()
    with _signed_client(uid) as c:
        c.test_user_id = uid
        c.test_pack_root = pack_root
        yield c


def _seed_outlined_draft(client) -> str:
    """Create a draft and add an outline manually (PUT)."""
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
    created["sections"] = [
        {
            "id": "s1",
            "title": "First",
            "brief": "b1",
            "content_md": "",
            "status": "empty",
            "word_count": 0,
        },
        {
            "id": "s2",
            "title": "Second",
            "brief": "b2",
            "content_md": "",
            "status": "empty",
            "word_count": 0,
        },
    ]
    created["stage"] = "outline"
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]


async def test_expand_returns_job_and_runs_sections(expand_client) -> None:
    did = _seed_outlined_draft(expand_client)
    r = expand_client.post(f"/api/drafts/{did}/expand")
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    with expand_client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        body = b"".join(resp.iter_bytes()).decode()
    assert '"type":"complete"' in body
    # Verify draft moved to sections stage with content
    final = expand_client.get(f"/api/drafts/{did}").json()
    assert final["stage"] == "sections"
    assert all(s["status"] in ("ready", "edited") for s in final["sections"])
    assert all(s["content_md"].strip() for s in final["sections"])


async def test_expand_persists_provider_recovery_metadata(expand_client, monkeypatch) -> None:
    async def fail_provider_resolution(*args, **kwargs):
        raise ProviderMissingKey("anthropic")

    monkeypatch.setattr("blogforge.api.expand.build_provider_for", fail_provider_resolution)
    did = _seed_outlined_draft(expand_client)
    seeded = expand_client.get(f"/api/drafts/{did}").json()
    seeded["stage"] = "sections"
    seeded["sections"][0].update(
        content_md="Completed prose stays intact.\n",
        status="ready",
        word_count=4,
    )
    assert expand_client.put(f"/api/drafts/{did}", json=seeded).status_code == 200

    response = expand_client.post(f"/api/drafts/{did}/expand?remaining_only=true")
    job_id = response.json()["job_id"]
    with expand_client.stream("GET", f"/api/jobs/{job_id}/events") as events:
        body = b"".join(events.iter_bytes()).decode()

    final = expand_client.get(f"/api/drafts/{did}").json()
    assert final["sections"][0]["content_md"] == "Completed prose stays intact.\n"
    assert final["sections"][0]["status"] == "ready"
    persisted = json.loads(final["sections"][1]["last_error"])
    assert persisted["version"] == 1
    assert persisted["code"] == "provider_missing_key"
    assert persisted["hint"] == "Add the key in Settings."
    assert '"code":"provider_missing_key"' in body


async def test_expand_rejects_a_second_active_generation(expand_client) -> None:
    did = _seed_outlined_draft(expand_client)
    active = await expand_client.app.state.job_registry.create(JobType.EXPAND, draft_id=did)

    response = expand_client.post(f"/api/drafts/{did}/expand")

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == {
        "code": "generation_already_active",
        "message": "A generation job is already active for this draft.",
        "job_id": active.id,
    }


async def test_expand_single_pass_composes_all_ignoring_limit(expand_client) -> None:
    """Single-pass writes the whole document in one call: `?limit=1` is accepted
    for API compatibility but composes ALL sections, not just the first."""
    did = _seed_outlined_draft(expand_client)
    r = expand_client.post(f"/api/drafts/{did}/expand?limit=1")
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    with expand_client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        body = b"".join(resp.iter_bytes()).decode()
    assert '"type":"complete"' in body

    secs = {s["id"]: s for s in expand_client.get(f"/api/drafts/{did}").json()["sections"]}
    # Both sections filled from the single-pass split, despite limit=1.
    assert secs["s1"]["content_md"].strip() and secs["s1"]["status"] == "ready"
    assert secs["s2"]["content_md"].strip() and secs["s2"]["status"] == "ready"


async def test_expand_remaining_preserves_completed_section_and_version_history(
    expand_client,
) -> None:
    did = _seed_outlined_draft(expand_client)
    seeded = expand_client.get(f"/api/drafts/{did}").json()
    seeded["stage"] = "sections"
    seeded["sections"][0].update(
        content_md="Historical baseline.\n",
        status="ready",
        word_count=2,
    )
    seeded["sections"][1].update(
        content_md="Partial failed prose.\n",
        status="failed",
        last_error="Previous provider failure",
        word_count=3,
    )
    assert expand_client.put(f"/api/drafts/{did}", json=seeded).status_code == 200
    # Create an existing completed-section history entry, then prove the
    # remaining-only compose neither adds to nor mutates that history.
    assert (
        expand_client.post(
            f"/api/drafts/{did}/sections/s1/save",
            json={"content_md": "Keep this exact.\n", "create_version": True},
        ).status_code
        == 200
    )
    before = expand_client.get(f"/api/drafts/{did}").json()
    completed_before = next(s for s in before["sections"] if s["id"] == "s1")
    completed_versions_before = expand_client.get(f"/api/drafts/{did}/sections/s1/versions").json()

    r = expand_client.post(f"/api/drafts/{did}/expand?remaining_only=true")
    assert r.status_code == 202
    with expand_client.stream("GET", f"/api/jobs/{r.json()['job_id']}/events") as resp:
        events = b"".join(resp.iter_bytes()).decode()

    final = expand_client.get(f"/api/drafts/{did}").json()
    sections = {s["id"]: s for s in final["sections"]}
    assert sections["s1"] == completed_before
    assert (
        expand_client.get(f"/api/drafts/{did}/sections/s1/versions").json()
        == completed_versions_before
    )
    assert sections["s2"]["content_md"].strip() == "Second section body."
    assert sections["s2"]["status"] == "ready"
    target_versions = expand_client.get(f"/api/drafts/{did}/sections/s2/versions").json()
    assert target_versions[0]["content_md"] == "Partial failed prose.\n"
    assert "section:done:s2" in events
    assert "section:done:s1" not in events


async def test_expand_remaining_does_not_overwrite_concurrent_editor_saves(
    expand_client, monkeypatch
) -> None:
    """A remaining-only job may finish after dirty editors flush newer prose."""
    did = _seed_outlined_draft(expand_client)
    seeded = expand_client.get(f"/api/drafts/{did}").json()
    seeded["stage"] = "sections"
    seeded["sections"][0].update(
        content_md="Completed baseline.\n",
        status="ready",
        word_count=2,
    )
    seeded["sections"][1].update(
        content_md="Failed baseline.\n",
        status="failed",
        last_error="Previous failure",
        word_count=2,
    )
    assert expand_client.put(f"/api/drafts/{did}", json=seeded).status_code == 200

    generation_started = asyncio.Event()
    release_generation = asyncio.Event()

    async def delayed_document(*args, **kwargs):
        generation_started.set()
        await release_generation.wait()
        return "## First\nGenerated first.\n\n## Second\nGenerated second.\n"

    async def fake_provider(*args, **kwargs):
        return object()

    async def no_context(*args, **kwargs):
        return ""

    monkeypatch.setattr(expand_api, "generate_document", delayed_document)
    monkeypatch.setattr(expand_api, "build_provider_for", fake_provider)
    monkeypatch.setattr(expand_api, "get_reference_context", no_context)
    monkeypatch.setattr("blogforge.voice.sources_context.build_background_context", no_context)
    monkeypatch.setattr(
        expand_api, "get_settings", lambda: SimpleNamespace(enforce_voice_rules=False)
    )

    store: SqlDraftStore = expand_client.app.state.draft_store
    registry = JobRegistry()
    job = await registry.create(JobType.EXPAND, draft_id=did)
    task = asyncio.create_task(
        expand_api._run_expand(
            registry,
            store,
            job.id,
            did,
            expand_client.test_pack_root,
            "anthropic",
            "mock-1",
            expand_client.test_user_id,
            remaining_only=True,
        )
    )
    await generation_started.wait()

    concurrent = await store.get(did, user_id=expand_client.test_user_id)
    assert concurrent is not None
    completed = next(section for section in concurrent.sections if section.id == "s1")
    target = next(section for section in concurrent.sections if section.id == "s2")
    await store.add_section_version(
        did,
        completed.id,
        user_id=expand_client.test_user_id,
        title=completed.title,
        content_md=completed.content_md,
        word_count=completed.word_count,
        status=completed.status,
        source="save",
    )
    completed.content_md = "Concurrent completed edit wins.\n"
    completed.word_count = 4
    completed.status = "edited"
    target.content_md = "Concurrent target edit wins.\n"
    target.word_count = 4
    target.status = "edited"
    target.last_error = None
    await store.update(did, concurrent, user_id=expand_client.test_user_id)

    release_generation.set()
    await task

    final = await store.get(did, user_id=expand_client.test_user_id)
    assert final is not None
    by_id = {section.id: section for section in final.sections}
    assert by_id["s1"].content_md == "Concurrent completed edit wins.\n"
    assert by_id["s1"].status == "edited"
    assert by_id["s2"].content_md == "Concurrent target edit wins.\n"
    assert by_id["s2"].status == "edited"
    versions = await store.list_section_versions(did, "s1", user_id=expand_client.test_user_id)
    assert [version.content_md for version in versions] == ["Completed baseline.\n"]


async def test_expand_outline_missing_409(expand_client) -> None:
    created = expand_client.post(
        "/api/drafts",
        json={
            "topic": "AI",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "mock-1",
        },
    ).json()
    r = expand_client.post(f"/api/drafts/{created['id']}/expand")
    assert r.status_code == 409
