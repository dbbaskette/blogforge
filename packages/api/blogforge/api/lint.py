"""POST /api/drafts/{id}/lint — section-anchored myvoice.lint + repetition.

Findings are linted per *section* so each carries `section_id` + section-local
UTF-16 offsets, which the editor uses to jump to and highlight the flagged
span. Repetition is cross-section by nature, so each repetition finding is
anchored to the first section whose prose contains the recycled phrase.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore

router = APIRouter(tags=["lint"])


@router.post("/api/drafts/{draft_id}/lint")
async def lint_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, list[dict[str, object]]]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    # Guard for non-profile drafts: fail fast if the pack is missing.
    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            raise HTTPException(
                404,
                detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}},
            )

    from blogforge.voice import validate_pack
    from blogforge.voice.lint import detect_positive_hits, lint_to_hits

    from blogforge.voice.resolve import resolve_voice

    pack_root = await resolve_voice(draft, current.id, pack_store=pack_store)
    result = validate_pack(pack_root)
    if result.manifest is None:
        raise HTTPException(
            500,
            detail={"error": {"code": "pack_invalid", "message": "Manifest validation failed."}},
        )

    from blogforge.drafts.repetition import analyze_repetition

    violations: list[dict[str, Any]] = []
    hits: list[dict[str, Any]] = []
    for section in draft.sections:
        body = section.content_md
        if not body.strip():
            continue
        for h in lint_to_hits(result.manifest, body):
            violations.append(_anchor_hit(h, "violation", section.id, body))
        for h in detect_positive_hits(body):
            hits.append(_anchor_hit(h, "hit", section.id, body))

    repetitions = [_anchor_repetition(f, draft.sections) for f in analyze_repetition(draft)]
    return {"violations": violations, "hits": hits, "repetitions": repetitions}


def _utf16_offset(text: str, char_index: int) -> int:
    """Python char index → UTF-16 code-unit offset (JS String.length semantics)."""
    return len(text[:char_index].encode("utf-16-le")) // 2


def _slice_utf16(text: str, start: int, end: int) -> str:
    """Slice `text` by UTF-16 code-unit offsets (the offsets myvoice emits)."""
    return text.encode("utf-16-le")[start * 2 : end * 2].decode("utf-16-le")


def _anchor_hit(hit: Any, kind: str, section_id: str, body: str) -> dict[str, Any]:
    """Shape a myvoice LintHit into a section-anchored finding dict."""
    match = getattr(hit, "match", "") or _slice_utf16(body, hit.start, hit.end)
    rule = getattr(hit, "rule_id", "") or getattr(hit, "rule", "")
    return {
        "id": f"{kind}:{section_id}:{hit.start}:{rule}",
        "kind": kind,
        "section_id": section_id,
        "start": hit.start,
        "end": hit.end,
        "match": match,
        "rule": rule,
        "message": hit.message,
    }


def _anchor_repetition(finding: dict[str, Any], sections: list[Any]) -> dict[str, Any]:
    """Resolve a cross-section repetition finding to the first section that
    contains its phrase, with section-local UTF-16 offsets when located."""
    text = str(finding.get("text", ""))
    phrase = text.rstrip("…").strip()
    rule = str(finding.get("rule", "repetition"))
    section_id: str | None = None
    start: int | None = None
    end: int | None = None
    match = phrase
    if phrase:
        needle = phrase.lower()
        for s in sections:
            idx = s.content_md.lower().find(needle)
            if idx >= 0:
                section_id = s.id
                start = _utf16_offset(s.content_md, idx)
                end = _utf16_offset(s.content_md, idx + len(phrase))
                match = s.content_md[idx : idx + len(phrase)]
                break
    return {
        "id": f"repetition:{section_id}:{start}:{rule}:{phrase[:20]}",
        "kind": "repetition",
        "section_id": section_id,
        "start": start,
        "end": end,
        "match": match,
        "rule": rule,
        "message": str(finding.get("message", "")),
    }
