"""Pydantic shapes for draft templates."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(UTC)


class TemplateInput(BaseModel):
    """The editable fields of a template (create / update body)."""

    name: str = Field(min_length=1, max_length=200)
    topic: str = ""
    pack_slug: str = Field(min_length=1)
    provider: Literal["anthropic", "openai", "google"]
    model: str = Field(min_length=1)
    target_words: int = Field(default=1500, ge=300, le=10000)
    format: str | None = None
    bullets: list[str] = Field(default_factory=list)
    notes: str = ""


class Template(TemplateInput):
    id: str
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class TemplateFromDraft(BaseModel):
    """Body for POST /api/templates/from-draft/{id} — just the new name;
    the idea defaults are lifted from the draft."""

    name: str = Field(min_length=1, max_length=200)
