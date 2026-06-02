"""POST /api/drafts/{id}/claims — fact-check the draft against its references."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.claims import check_claims
from blogforge.generate.references import get_reference_context
from blogforge.keys import KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider

router = APIRouter(tags=["claims"])


@router.post("/api/drafts/{draft_id}/claims")
async def claims(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    store: SqlDraftStore = request.app.state.draft_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    md = store.assemble_markdown(draft)
    if not any(s.content_md.strip() for s in draft.sections):
        raise HTTPException(
            409,
            detail={"error": {"code": "empty_draft", "message": "Write some sections first."}},
        )

    api_key = await KeyVault().get(draft.idea.provider)
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key for {draft.idea.provider}",
                    "hint": "An admin can add one under /admin (API keys section).",
                }
            },
        )

    reference_context = await get_reference_context(draft.id, draft.references)
    provider = get_provider(draft.idea.provider, api_key)
    try:
        results = await check_claims(
            md, reference_context, provider, model=draft.idea.model
        )
    except (ProviderMissingKey, ProviderError) as e:
        raise HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}
        ) from e
    return {"claims": results, "has_references": bool(draft.references)}
