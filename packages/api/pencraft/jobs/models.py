"""Job model and related enums."""
from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class JobType(StrEnum):
    EXPAND = "expand"
    REGEN_SECTION = "regen_section"
    IDEATION = "ideation"


JobStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]


class Job(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    type: JobType
    status: JobStatus = "pending"
    stage: str = "queued"
    progress: float = 0.0
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    partial_text: str = ""
    result: dict[str, object] | None = None
    error: dict[str, object] | None = None
