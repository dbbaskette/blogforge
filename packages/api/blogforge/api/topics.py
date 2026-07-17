"""POST /api/ideation/topics — brainstorm post ideas before a draft exists.

Powers the compose page's "Spark ideas" button. Voice-aware (materializes the
user's profile or the chosen pack) but draft-free, so a writer with a blank
Topic box can get unstuck without first creating a draft.
"""
from __future__ import annotations

from types import SimpleNamespace

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.generate.topics import generate_topics
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.llm.types import TextProvider
from blogforge.voice.compose import ComposeError
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["ideation"])


class _TopicsBody(BaseModel):
    # What the writer has typed so far (may be empty — then we free-brainstorm).
    seed: str = Field(default="", max_length=2000)
    provider: TextProvider
    model: str = Field(min_length=1)
    use_voice_profile: bool = True
    pack_slug: str = ""
    n: int = Field(default=5, ge=3, le=8)


@router.post("/api/ideation/topics")
async def spark_topics(
    body: _TopicsBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    pack_store = request.app.state.pack_store

    # resolve_voice only reads idea.use_voice_profile / idea.pack_slug, so a
    # lightweight shim stands in for a Draft — no persistence needed.
    shim = SimpleNamespace(
        idea=SimpleNamespace(
            use_voice_profile=body.use_voice_profile,
            pack_slug=body.pack_slug,
        )
    )

    if not body.use_voice_profile:
        if pack_store.get(body.pack_slug) is None:
            raise HTTPException(
                404, detail={"error": {"code": "pack_not_found", "message": body.pack_slug}}
            )

    pack_root = await resolve_voice(shim, current.id, pack_store=pack_store)
    manifest = yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    provider = await build_provider_for(current.id, body.provider)
    try:
        topics = await generate_topics(
            pack_root,
            manifest,
            provider,
            model=body.model,
            seed=body.seed,
            n=body.n,
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
                    "hint": "Check your voice profile / pack manifest.",
                }
            },
        ) from e
    return {"topics": topics}
