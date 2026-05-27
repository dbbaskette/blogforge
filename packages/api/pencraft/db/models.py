"""ORM models — User, Draft, Section.

Uses SQLAlchemy 2.0 typed-mapped style. JSON columns store the existing
pydantic structures (IdeaInput, OutlineProposal) as dicts — they're
validated at the API boundary, not at the ORM boundary.
"""
from datetime import datetime, UTC
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
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="idea")
    # one of: "idea" | "outline" | "sections"
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


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("draft_id", "position", name="uq_section_position"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # the existing slugged section id ("01-the-tax", etc.)
    draft_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True
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
