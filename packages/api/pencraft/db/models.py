"""ORM models — User, Draft, Section.

Uses SQLAlchemy 2.0 typed-mapped style. JSON columns store the existing
pydantic structures (IdeaInput, OutlineProposal) as dicts — they're
validated at the API boundary, not at the ORM boundary.
"""
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from pencraft.db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> UUID:
    return uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # one of: "pending" | "approved" | "rejected" | "disabled"
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    # one of: "user" | "admin"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    drafts: Mapped[list["Draft"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="research")
    # one of: "research" | "outline" | "sections"
    # ("idea" was the pre-Phase-B name; existing rows get coerced at the
    # SqlDraftStore boundary, and migration 0003 rewrites them in place.)
    idea: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    outline: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="drafts")
    sections: Mapped[list["Section"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
        order_by="Section.position",
    )
    references: Mapped[list["Reference"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
        order_by="Reference.added_at",
    )
    ideation_messages: Mapped[list["IdeationMessage"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
        order_by="IdeationMessage.position",
    )


class Reference(Base):
    """A reference document attached to a draft (URL, uploaded file, or pasted text).

    Metadata only — extracted markdown + originals live in S3 at
    ``drafts/{draft_id}/references/{originals,extracted}/{id}.*``.
    """

    __tablename__ = "references"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    # one of: "url" | "file" | "text"
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    extracted_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    draft: Mapped[Draft] = relationship(back_populates="references")


class IdeationMessage(Base):
    """A single message in the research-stage chat for a draft.

    Ordered by ``position`` (0-based); assistant messages may carry a
    ``proposed_outline`` JSON blob that the user can Accept to advance
    the draft into the outline stage.
    """

    __tablename__ = "ideation_messages"
    __table_args__ = (
        UniqueConstraint("draft_id", "position", name="uq_ideation_position"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # one of: "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_outline: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    draft: Mapped[Draft] = relationship(back_populates="ideation_messages")


class ProviderKey(Base):
    """Admin-managed LLM provider API key.

    One row per provider (anthropic, openai, google). `encrypted_key`
    holds the SecretCipher ciphertext, never the raw key. `updated_by`
    is the admin who last touched the row (for audit).
    """

    __tablename__ = "provider_keys"

    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    encrypted_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("draft_id", "position", name="uq_section_position"),)

    # Slugged section id ("the-pattern", "01-the-tax", etc.). The LLM reuses
    # slugs across drafts, so the id is only unique *within* a draft — the PK
    # is composite (draft_id, id), not id alone.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    brief: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="empty")
    last_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    draft: Mapped[Draft] = relationship(back_populates="sections")
