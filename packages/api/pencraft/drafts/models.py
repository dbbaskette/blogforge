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


DraftStage = Literal["research", "outline", "sections"]

ReferenceKind = Literal["url", "file", "text"]


class Reference(BaseModel):
    """Metadata for a reference document attached to a draft.

    Content (extracted markdown + original) lives in S3 keyed by id;
    this shape is what the API returns and what gets persisted to the
    `references` table.
    """

    id: str
    kind: ReferenceKind
    name: str
    url: str | None = None
    original_filename: str | None = None
    extracted_chars: int = 0
    added_at: datetime = Field(default_factory=_now)


IdeationRole = Literal["user", "assistant"]


class IdeationMessage(BaseModel):
    id: str
    position: int
    role: IdeationRole
    content: str
    proposed_outline: OutlineProposal | None = None
    timestamp: datetime = Field(default_factory=_now)


class IdeationSession(BaseModel):
    """The full ordered chat history for a draft. Just sugar around the list."""

    messages: list[IdeationMessage] = Field(default_factory=list)


class Draft(BaseModel):
    id: str = Field(default_factory=_uuid)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    title: str = ""
    stage: DraftStage = "research"
    idea: IdeaInput
    outline: OutlineProposal | None = None
    sections: list[Section] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    ideation_messages: list[IdeationMessage] = Field(default_factory=list)


class DraftSummary(BaseModel):
    id: str
    title: str
    stage: DraftStage
    pack_slug: str
    updated_at: datetime
    word_count: int
