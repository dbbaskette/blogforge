"""POST /api/drafts/{id}/lint."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import pytest_asyncio

from tests.conftest import _seed_approved_user, _signed_client

_MYVOICE_DAN = Path("/Users/dbbaskette/Projects/myvoice/packs/dan")


@pytest_asyncio.fixture
async def lint_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    if not _MYVOICE_DAN.exists():
        pytest.skip("requires myvoice's dan pack")
    packs_root = tmp_path / "packs"
    packs_root.mkdir()
    shutil.copytree(_MYVOICE_DAN, packs_root / "dan")
    monkeypatch.setenv("MYVOICE_PACKS_ROOT", str(packs_root))

    uid = await _seed_approved_user()
    with _signed_client(uid) as c:
        yield c


@pytest.mark.skipif(not _MYVOICE_DAN.exists(), reason="requires myvoice's dan pack")
async def test_lint_returns_violations_and_hits(lint_client) -> None:
    created = lint_client.post(
        "/api/drafts",
        json={"topic": "Test topic", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = lint_client.post(f"/api/drafts/{created['id']}/lint")
    assert r.status_code == 200
    body = r.json()
    assert "violations" in body
    assert "hits" in body
    assert isinstance(body["violations"], list)
    assert isinstance(body["hits"], list)


@pytest.mark.skipif(not _MYVOICE_DAN.exists(), reason="requires myvoice's dan pack")
async def test_lint_unknown_draft_404(lint_client) -> None:
    r = lint_client.post("/api/drafts/nope/lint")
    assert r.status_code == 404
