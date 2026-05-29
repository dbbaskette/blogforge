"""GET /api/packs — wraps myvoice.PackStore."""
from __future__ import annotations

from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/packs", tags=["packs"])


def _voice_preview(info: Any) -> dict[str, str]:
    """Pull a short voice preview (pack.description + persona.one_line) from
    the pack's stylepack.yaml. Best-effort: empty strings on any read error,
    so a malformed pack never breaks the list."""
    try:
        manifest = (
            yaml.safe_load((info.root_path / "stylepack.yaml").read_text(encoding="utf-8"))
            or {}
        )
    except (OSError, yaml.YAMLError):
        return {"description": "", "one_line": ""}
    pack = manifest.get("pack") or {}
    persona = manifest.get("persona") or {}
    return {
        "description": str(pack.get("description") or ""),
        "one_line": str(persona.get("one_line") or ""),
    }


@router.get("")
def list_packs(request: Request) -> list[dict[str, Any]]:
    store = request.app.state.pack_store
    out: list[dict[str, Any]] = []
    for info in (store.get(slug) for slug in store.slugs()):
        if info is None:
            continue
        preview = _voice_preview(info)
        out.append(
            {
                "slug": info.slug,
                "name": info.name,
                "version": info.version,
                "valid": info.valid,
                "error_count": len(info.errors),
                "description": preview["description"],
                "one_line": preview["one_line"],
            }
        )
    return out


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
