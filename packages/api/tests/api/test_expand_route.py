"""POST /api/drafts/{id}/expand."""
from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from pencraft.server import create_app

_MYVOICE_DAN = Path("/Users/dbbaskette/Projects/myvoice/packs/dan")


@pytest.fixture
def expand_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    if not _MYVOICE_DAN.exists():
        pytest.skip("requires myvoice dan pack")
    packs_root = tmp_path / "packs"
    packs_root.mkdir()
    shutil.copytree(_MYVOICE_DAN, packs_root / "dan")
    cfg = tmp_path / "myvoice_config.yaml"
    cfg.write_text(yaml.safe_dump({"providers": {"anthropic": {"api_key": "sk-mock"}}}))
    monkeypatch.setenv("MYVOICE_PACKS_ROOT", str(packs_root))
    monkeypatch.setenv("MYVOICE_CONFIG_PATH", str(cfg))
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    monkeypatch.setenv("PENCRAFT_TEST_PROVIDER", "mock")
    monkeypatch.setenv("PENCRAFT_MOCK_OUTPUT", "Section body content here.")
    app = create_app()
    with TestClient(app) as c:
        yield c


def _seed_outlined_draft(client: TestClient) -> str:
    """Create a draft and add an outline manually (PUT)."""
    created = client.post(
        "/api/drafts",
        json={
            "topic": "AI",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "mock-1",
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
            "id": "s1", "title": "First", "brief": "b1",
            "content_md": "", "status": "empty", "word_count": 0,
        },
        {
            "id": "s2", "title": "Second", "brief": "b2",
            "content_md": "", "status": "empty", "word_count": 0,
        },
    ]
    created["stage"] = "outline"
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]  # type: ignore[no-any-return]


def test_expand_returns_job_and_runs_sections(expand_client: TestClient) -> None:
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


def test_expand_outline_missing_409(expand_client: TestClient) -> None:
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
