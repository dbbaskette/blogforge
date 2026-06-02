"""POST /api/drafts/{id}/repurpose — turn a finished draft into another channel.

GET /api/repurpose/formats lists the available channels for the UI.
Synchronous: the outputs are short, so the request blocks on one
provider.complete() and returns the repurposed text.
"""
from __future__ import annotations

from typing import Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from myvoice.compose import ComposeError
from pydantic import BaseModel

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.repurpose import FORMATS, repurpose
from blogforge.keys import KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider

router = APIRouter(tags=["repurpose"])


class _RepurposeBody(BaseModel):
    format: Literal["x_thread", "linkedin", "newsletter", "tldr", "meta_description", "email"]


@router.get("/api/repurpose/formats")
async def list_formats(
    current: User = Depends(get_current_user),
) -> list[dict[str, str]]:
    return [{"id": key, "label": spec["label"]} for key, spec in FORMATS.items()]


@router.post("/api/drafts/{draft_id}/repurpose")
async def repurpose_draft(
    draft_id: str,
    body: _RepurposeBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    md = store.assemble_markdown(draft)
    if not md.strip() or not any(s.content_md.strip() for s in draft.sections):
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "empty_draft",
                    "message": "Write some sections before repurposing.",
                }
            },
        )

    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
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

    manifest = yaml.safe_load(
        (pack_info.root_path / "stylepack.yaml").read_text(encoding="utf-8")
    ) or {}
    provider = get_provider(draft.idea.provider, api_key)
    try:
        result = await repurpose(
            draft,
            pack_info.root_path,
            manifest,
            provider,
            model=draft.idea.model,
            body=md,
            fmt=body.format,
        )
    except (ProviderMissingKey, ProviderError) as e:
        raise HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}
        ) from e
    except ComposeError as e:
        raise HTTPException(
            500,
            detail={
                "error": {
                    "code": "compose_error",
                    "message": str(e),
                    "hint": "Check the draft's format/samples against the pack manifest.",
                }
            },
        ) from e
    return {"format": body.format, "text": result}
