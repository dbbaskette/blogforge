"""Hero image — generate (Google Imagen), serve, and clear.

POST   /api/drafts/{id}/hero-image   generate + store + persist key
GET    /api/drafts/{id}/hero-image   stream the stored image bytes
DELETE /api/drafts/{id}/hero-image   clear the hero image

Image generation is Google-only (Imagen), so it pulls the Google key from the
vault regardless of the draft's text provider.
"""
from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.hero import build_hero_prompt, generate_hero_image
from blogforge.keys import KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.s3.client import get_s3_client

router = APIRouter(tags=["hero"])


class _HeroBody(BaseModel):
    # Optional override; when blank we derive a prompt from the draft subject.
    prompt: str = ""


def _key_for(draft_id: str) -> str:
    return f"drafts/{draft_id}/hero/{uuid4().hex}.png"


@router.post("/api/drafts/{draft_id}/hero-image")
async def generate_hero(
    draft_id: str,
    body: _HeroBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})

    api_key = await KeyVault().get("google")
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": "Hero images need a Google API key.",
                    "hint": "An admin can add the Google key under /admin (API keys section).",
                }
            },
        )

    prompt = body.prompt.strip() or build_hero_prompt(draft)
    try:
        image_bytes, mime = await generate_hero_image(prompt, api_key)
    except ProviderMissingKey as e:
        raise HTTPException(400, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}) from e
    except ProviderError as e:
        raise HTTPException(
            502, detail={"error": {"code": e.code, "message": e.message, "hint": e.hint}}
        ) from e

    key = _key_for(draft_id)
    await get_s3_client().put_object(key, image_bytes, mime)

    # Best-effort cleanup of the previous image so S3 doesn't accumulate orphans.
    old = draft.hero_image_key
    draft.hero_image_key = key
    await store.update(draft.id, draft, user_id=current.id)
    if old:
        try:
            await get_s3_client().delete_object(old)
        except Exception:  # noqa: BLE001 — cleanup is best-effort
            pass
    return {"hero_image_key": key}


@router.get("/api/drafts/{draft_id}/hero-image")
async def serve_hero(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None or not draft.hero_image_key:
        raise HTTPException(404, detail={"error": {"code": "no_hero_image", "message": draft_id}})
    image_bytes = await get_s3_client().get_object(draft.hero_image_key)
    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.delete("/api/drafts/{draft_id}/hero-image", status_code=204)
async def delete_hero(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    key = draft.hero_image_key
    if key:
        draft.hero_image_key = None
        await store.update(draft.id, draft, user_id=current.id)
        try:
            await get_s3_client().delete_object(key)
        except Exception:  # noqa: BLE001 — cleanup is best-effort
            pass
    return Response(status_code=204)
