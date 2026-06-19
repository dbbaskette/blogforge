"""Pydantic models for a Style Pack manifest (`stylepack.yaml`).

Models match SPEC.md v1.0. Unknown fields are rejected (model_config
forbids extra). This catches typos like `no_em_dash` vs `no_em_dashes`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Pack(_StrictModel):
    slug: str = Field(min_length=1)
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    author: str = Field(min_length=1)
    description: str | None = None
    homepage: str | None = None


class Persona(_StrictModel):
    identity: str = Field(min_length=1)
    one_line: str = Field(min_length=1)
    tone: str | None = None


class PermittedException(_StrictModel):
    term: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class Banished(_StrictModel):
    words: list[str] = Field(default_factory=list)
    phrases: list[str] = Field(default_factory=list)
    permitted_exceptions: list[PermittedException] = Field(default_factory=list)


class Rules(_StrictModel):
    no_em_dashes: bool = True
    no_ascii_double_hyphen_between_letters: bool = True
    no_sentence_starters: list[str] = Field(default_factory=list)


class PopCulture(_StrictModel):
    allowed: list[str] = Field(default_factory=list)
    banned: list[str] = Field(default_factory=list)


class Format(_StrictModel):
    name: str = Field(min_length=1)
    file: str = Field(min_length=1)
    description: str | None = None


class Sample(_StrictModel):
    id: str = Field(min_length=1)
    file: str = Field(min_length=1)
    description: str | None = None


class Bio(_StrictModel):
    name: str = Field(min_length=1)
    file: str = Field(min_length=1)
    max_chars: int | None = Field(default=None, gt=0)
    target_words: int | None = Field(default=None, gt=0)
    third_person: bool = False
    description: str | None = None


class Manifest(_StrictModel):
    spec_version: Literal["1.0"]
    pack: Pack
    persona: Persona
    banished: Banished = Field(default_factory=Banished)
    rules: Rules = Field(default_factory=Rules)
    pop_culture: PopCulture = Field(default_factory=PopCulture)
    formats: list[Format] = Field(default_factory=list)
    samples: list[Sample] = Field(default_factory=list)
    bios: list[Bio] = Field(default_factory=list)
