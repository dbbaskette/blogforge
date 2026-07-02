"""Pydantic shapes for voice profiles and samples."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from blogforge.utctime import UtcDatetime


def _now() -> datetime:
    return datetime.now(UTC)


class VoiceRules(BaseModel):
    banished_words: list[str] = Field(default_factory=list)
    banished_phrases: list[str] = Field(default_factory=list)
    no_em_dashes: bool = False
    no_ascii_double_hyphen: bool = False


SampleKind = Literal["text", "url", "file"]
SampleStatus = Literal["ready", "failed"]
SourceStatus = Literal["ready", "failed"]


class VoiceSample(BaseModel):
    id: str
    kind: SampleKind
    name: str = ""
    source_url: str | None = None
    original_filename: str | None = None
    s3_key: str
    extracted_chars: int = 0
    exemplar: bool = False
    status: SampleStatus = "ready"
    added_at: UtcDatetime = Field(default_factory=_now)


class VoiceSource(BaseModel):
    id: str
    url: str
    name: str = ""
    s3_key: str
    extracted_chars: int = 0
    status: SourceStatus = "ready"
    added_at: UtcDatetime = Field(default_factory=_now)


class VoiceProfile(BaseModel):
    id: str
    user_id: str
    name: str = "My Voice"
    persona_identity: str = ""
    persona_one_line: str = ""
    persona_tone: str = ""
    rules: VoiceRules = Field(default_factory=VoiceRules)
    distilled_style_md: str = ""
    distilled_at: UtcDatetime | None = None
    version: int = 1
    samples: list[VoiceSample] = Field(default_factory=list)
