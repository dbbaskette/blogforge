"""GET /api/help/rules — live rule data for the Help page."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.generate.geo import lever_catalog
from blogforge.generate.humanize import parsed_lenses
from blogforge.voice.ai_tells import load_ai_tells, parsed_patterns

router = APIRouter(prefix="/api/help", tags=["help"])


@router.get("/rules")
async def help_rules(current: User = Depends(get_current_user)) -> dict[str, object]:
    tells = load_ai_tells()
    return {
        "humanize": {
            "words": sorted(tells.words, key=str.lower),
            "phrases": sorted(tells.phrases, key=str.lower),
            "sentence_starters": list(tells.sentence_starters),
            "patterns": parsed_patterns(),
            "lenses": parsed_lenses(),
        },
        "geo": {"levers": lever_catalog()},
    }
