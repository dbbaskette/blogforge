"""GET /api/packs — wraps myvoice.PackStore."""
from __future__ import annotations

from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/packs", tags=["packs"])


@router.get("")
def list_packs(request: Request) -> list[dict[str, Any]]:
    store = request.app.state.pack_store
    return [
        {
            "slug": info.slug,
            "name": info.name,
            "version": info.version,
            "valid": info.valid,
            "error_count": len(info.errors),
        }
        for info in (store.get(slug) for slug in store.slugs())
        if info is not None
    ]


@router.get("/{slug}/manifest")
def get_manifest(slug: str, request: Request) -> dict[str, Any]:
    store = request.app.state.pack_store
    info = store.get(slug)
    if info is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "pack_not_found", "message": f"No pack '{slug}'"}},
        )
    manifest_path = info.root_path / "stylepack.yaml"
    return yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
