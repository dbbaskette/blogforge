"""Pydantic shapes for drafts."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return uuid4().hex


class IdeaInput(BaseModel):
    topic: str = Field(min_length=1)
    bullets: list[str] = Field(default_factory=list)
    pack_slug: str = Field(min_length=1)
    format: str | None = None
    provider: Literal["anthropic", "openai", "google"]
    model: str = Field(min_length=1)
    target_words: int = Field(default=1500, ge=300, le=10000)
    notes: str = ""


class OutlineSection(BaseModel):
    id: str = Field(default_factory=_uuid)
    title: str = Field(min_length=1)
    brief: str = ""


class OutlineProposal(BaseModel):
    opening_hook: str = ""
    sections: list[OutlineSection] = Field(default_factory=list)
    estimated_words: int = 0


SectionStatus = Literal["empty", "generating", "ready", "failed", "edited"]


class Section(BaseModel):
    id: str
    title: str
    brief: str = ""
    content_md: str = ""
    status: SectionStatus = "empty"
    last_generated_at: datetime | None = None
    last_error: str | None = None
    word_count: int = 0


DraftStage = Literal["idea", "outline", "sections"]


class Draft(BaseModel):
    id: str = Field(default_factory=_uuid)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    title: str = ""
    stage: DraftStage = "idea"
    idea: IdeaInput
    outline: OutlineProposal | None = None
    sections: list[Section] = Field(default_factory=list)


class DraftSummary(BaseModel):
    id: str
    title: str
    stage: DraftStage
    pack_slug: str
    updated_at: datetime
    word_count: int
