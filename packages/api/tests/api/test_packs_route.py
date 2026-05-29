"""GET /api/packs — wraps myvoice."""
from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pencraft.server import create_app

_MYVOICE_DAN = Path("/Users/dbbaskette/Projects/myvoice/packs/dan")


@pytest.fixture
def client_with_packs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    packs_root = tmp_path / "packs"
    packs_root.mkdir()
    if _MYVOICE_DAN.exists():
        shutil.copytree(_MYVOICE_DAN, packs_root / "dan")
    monkeypatch.setenv("MYVOICE_PACKS_ROOT", str(packs_root))
    monkeypatch.setenv("PENCRAFT_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.mark.skipif(not _MYVOICE_DAN.exists(), reason="requires myvoice's dan pack")
def test_list_packs(client_with_packs: TestClient) -> None:
    r = client_with_packs.get("/api/packs")
    assert r.status_code == 200
    body = r.json()
    slugs = [p["slug"] for p in body]
    assert "dan" in slugs


@pytest.mark.skipif(not _MYVOICE_DAN.exists(), reason="requires myvoice's dan pack")
def test_list_packs_includes_voice_preview(client_with_packs: TestClient) -> None:
    """Each pack carries a short voice preview for the picker."""
    dan = next(p for p in client_with_packs.get("/api/packs").json() if p["slug"] == "dan")
    assert "description" in dan and "one_line" in dan
    # dan's stylepack has both populated.
    assert dan["description"]
    assert dan["one_line"]


@pytest.mark.skipif(not _MYVOICE_DAN.exists(), reason="requires myvoice's dan pack")
def test_get_manifest(client_with_packs: TestClient) -> None:
    r = client_with_packs.get("/api/packs/dan/manifest")
    assert r.status_code == 200
    assert r.json()["pack"]["slug"] == "dan"


def test_get_manifest_unknown_pack(client_with_packs: TestClient) -> None:
    r = client_with_packs.get("/api/packs/nonexistent/manifest")
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "pack_not_found"
