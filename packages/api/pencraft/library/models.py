"""Pydantic shape for a library reference (the API view)."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(UTC)


class LibraryReference(BaseModel):
    id: str
    kind: Literal["url", "file", "text"]
    name: str
    url: str | None = None
    original_filename: str | None = None
    extracted_chars: int = 0
    added_at: datetime = Field(default_factory=_now)
