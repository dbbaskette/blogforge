"""POST /api/drafts/{id}/humanize — additive 'sound human' rewrites.

Mirrors api/geo.py: resolve the voice, load the manifest via the pack root,
build the provider, delegate to the generator. Reuses geo.py's `_load` /
`_provider_error` helpers rather than duplicating the loader.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from blogforge.api.geo import _load, _provider_error
from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.generate.humanize import analyze_humanize
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.voice.compose import ComposeError

router = APIRouter(tags=["humanize"])


class _HumanizeBody(BaseModel):
    intensity: Literal["light", "medium", "strong"] = "medium"


@router.post("/api/drafts/{draft_id}/humanize")
async def humanize_report(
    draft_id: str,
    body: _HumanizeBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    draft, pack_root, _manifest, provider = await _load(request, draft_id, current)
    try:
        return await analyze_humanize(
            draft, pack_root, provider, intensity=body.intensity, model=draft.idea.model
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
