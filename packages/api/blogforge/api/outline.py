"""POST /api/drafts/{id}/outline — sync outline generation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from myvoice.compose import ComposeError

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.models import Draft, OutlineProposal
from blogforge.generate.outline import propose_outline
from blogforge.generate.references import get_reference_context
from blogforge.keys import KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["outline"])


@router.post("/api/drafts/{draft_id}/outline")
async def generate_outline(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    store = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft: Draft | None = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "draft_not_found", "message": f"No draft '{draft_id}'"}},
        )

    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            slug = draft.idea.pack_slug
            raise HTTPException(
                404,
                detail={"error": {"code": "pack_not_found", "message": f"No pack '{slug}'"}},
            )

    pack_root = await resolve_voice(draft, current.id, pack_store=pack_store)

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

    import yaml

    manifest = (
        yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    )

    reference_context = await get_reference_context(draft.id, draft.references)

    try:
        provider = get_provider(draft.idea.provider, api_key)
        proposal: OutlineProposal = await propose_outline(
            draft.idea,
            pack_root,
            manifest,
            provider,
            model=draft.idea.model,
            reference_context=reference_context,
        )
    except ProviderMissingKey as e:
        raise HTTPException(
            400, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}
        ) from e
    except ProviderError as e:
        raise HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message}}
        ) from e
    except ComposeError as e:
        raise HTTPException(
            422,
            detail={
                "error": {
                    "code": "compose_error",
                    "message": str(e),
                    "hint": "Pick a different format/sample from the pack, or clear the field.",
                }
            },
        ) from e
    except ValueError as e:
        raise HTTPException(
            422,
            detail={"error": {"code": "invalid_outline_json", "message": str(e)}},
        ) from e

    draft.outline = proposal
    # Seed sections from outline so Stage 3 already has the section shells
    from blogforge.drafts.models import Section

    draft.sections = [
        Section(id=s.id, title=s.title, brief=s.brief)
        for s in proposal.sections
    ]
    draft.stage = "outline"
    if not draft.title:
        draft.title = draft.idea.topic
    updated = await store.update(draft.id, draft, user_id=current.id)
    return updated if updated is not None else draft
