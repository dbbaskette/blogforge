"""POST /api/drafts/{id}/lint — wraps myvoice.lint over assembled markdown."""
from __future__ import annotations

import dataclasses

from fastapi import APIRouter, HTTPException, Request

from pencraft.drafts import DraftStore

router = APIRouter(tags=["lint"])


@router.post("/api/drafts/{draft_id}/lint")
def lint_draft(draft_id: str, request: Request) -> dict[str, list[dict[str, object]]]:
    store: DraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = store.get(draft_id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}},
        )

    from myvoice import validate_pack
    from myvoice.lint import detect_positive_hits, lint_to_hits

    result = validate_pack(pack_info.root_path)
    if result.manifest is None:
        raise HTTPException(
            500,
            detail={"error": {"code": "pack_invalid", "message": "Manifest validation failed."}},
        )

    md = store.assemble_markdown(draft)
    violations = lint_to_hits(result.manifest, md)
    hits = detect_positive_hits(md)
    return {
        "violations": [dataclasses.asdict(v) for v in violations],
        "hits": [dataclasses.asdict(h) for h in hits],
    }
