"""Pydantic shapes for drafts."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

from blogforge.llm.types import TextProvider
from blogforge.utctime import UtcDatetime


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return uuid4().hex


class IdeaInput(BaseModel):
    topic: str = Field(min_length=1)
    bullets: list[str] = Field(default_factory=list)
    # URLs pasted at compose-start. create_draft fetches each as a reference so
    # the first outline/draft is grounded in real source material. Capped at 10.
    source_urls: list[str] = Field(default_factory=list, max_length=10)
    # Required only when generating from a pack. In voice-profile mode the pack
    # is irrelevant (resolve_voice materializes the profile and never reads
    # pack_slug), so a fresh profile-only user can compose without picking one.
    pack_slug: str = ""
    format: str | None = None
    provider: TextProvider
    model: str = Field(min_length=1)
    target_words: int = Field(default=1500, ge=300, le=10000)
    notes: str = ""
    use_voice_profile: bool = True

    @model_validator(mode="after")
    def _pack_required_for_pack_mode(self) -> IdeaInput:
        if not self.use_voice_profile and not self.pack_slug:
            raise ValueError("pack_slug is required when use_voice_profile is false")
        return self


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
    last_generated_at: UtcDatetime | None = None
    last_error: str | None = None
    word_count: int = 0


VersionSource = Literal["regenerate", "save", "revert"]


class SectionVersion(BaseModel):
    """A stored snapshot of a section's prior content, surfaced in the
    section version-history panel."""

    id: str
    section_id: str
    title: str = ""
    content_md: str = ""
    word_count: int = 0
    status: SectionStatus = "ready"
    source: VersionSource = "regenerate"
    created_at: UtcDatetime = Field(default_factory=_now)


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
    added_at: UtcDatetime = Field(default_factory=_now)


IdeationRole = Literal["user", "assistant"]


class IdeationMessage(BaseModel):
    id: str
    position: int
    role: IdeationRole
    content: str
    proposed_outline: OutlineProposal | None = None
    timestamp: UtcDatetime = Field(default_factory=_now)


class IdeationSession(BaseModel):
    """The full ordered chat history for a draft. Just sugar around the list."""

    messages: list[IdeationMessage] = Field(default_factory=list)


class ReferenceWarning(BaseModel):
    """A source URL that couldn't be fetched at compose-start (non-fatal)."""

    url: str
    error: str


class Draft(BaseModel):
    id: str = Field(default_factory=_uuid)
    created_at: UtcDatetime = Field(default_factory=_now)
    updated_at: UtcDatetime = Field(default_factory=_now)
    title: str = ""
    stage: DraftStage = "research"
    idea: IdeaInput
    outline: OutlineProposal | None = None
    sections: list[Section] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    # Transient: only create_draft populates this (a source URL that failed to
    # fetch at compose-start). Empty on every other Draft response.
    reference_warnings: list[ReferenceWarning] = Field(default_factory=list)
    ideation_messages: list[IdeationMessage] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    # S3 key of the AI-generated hero image, if any. Served via the hero-image
    # endpoint; included in HTML/frontmatter export.
    hero_image_key: str | None = None
    published_at: UtcDatetime | None = None
    published_path: str | None = None
    published_sha: str | None = None
    published_commit_url: str | None = None

    @field_validator("stage", mode="before")
    @classmethod
    def _coerce_legacy_stage(cls, v: object) -> object:
        """Backwards-compat: pre-Phase-B clients send stage="idea"; coerce
        to "research" so their PUTs validate against the new Literal.

        Safe to remove once we're confident no caller still emits "idea"
        — a deprecation window of a release or two is fine."""
        if v == "idea":
            import logging
            logging.getLogger(__name__).warning(
                "Draft body sent stage='idea'; coercing to 'research'."
            )
            return "research"
        return v


class DraftSummary(BaseModel):
    id: str
    title: str
    stage: DraftStage
    pack_slug: str
    updated_at: UtcDatetime
    word_count: int
    tags: list[str] = Field(default_factory=list)
