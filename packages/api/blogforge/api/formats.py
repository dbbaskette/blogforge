"""GET /api/formats — built-in output formats for the compose Format picker.

These are pack- and voice-independent: the format shapes the article's
structure while the selected voice profile/pack controls the tone. The picker
shows them regardless of which voice source is active.
"""
from __future__ import annotations

from fastapi import APIRouter

from blogforge.generate.builtin_formats import list_builtin_formats

router = APIRouter(prefix="/api/formats", tags=["formats"])


@router.get("")
def list_formats() -> list[dict[str, str]]:
    """The built-in formats: [{name, description}]. `name` is the slug stored on
    the draft's idea.format; `description` is the human label for the option."""
    return list_builtin_formats()
