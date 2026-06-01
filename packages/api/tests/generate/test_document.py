"""Single-pass document generation: the whole post is one LLM call, then split
back onto the section model by H2 heading."""
from __future__ import annotations

from pathlib import Path

import pytest

from blogforge.drafts.models import (
    Draft,
    IdeaInput,
    OutlineProposal,
    OutlineSection,
    Section,
)
from blogforge.generate.document import (
    _render_document_prompt,
    generate_document,
    split_document,
)
from blogforge.llm.base import LLMResponse

_STYLEPACK_YAML = """
spec_version: '1.0'
pack:
  slug: dan
  name: Dan
  version: '1.0'
  author: Dan
persona:
  identity: x
  one_line: y
"""


def _fake_pack(tmp_path: Path) -> Path:
    pack_root = tmp_path / "fakepack"
    pack_root.mkdir()
    (pack_root / "stylepack.yaml").write_text(_STYLEPACK_YAML)
    (pack_root / "style-guide.md").write_text("Be brief.\n")
    return pack_root


def _sections() -> list[Section]:
    return [
        Section(id="s1", title="The Betrayal", brief="b1"),
        Section(id="s2", title="The Concept", brief="b2"),
        Section(id="s3", title="The Payoff", brief="b3"),
    ]


def _draft() -> Draft:
    return Draft(
        title="Local-First",
        idea=IdeaInput(
            topic="local-first", pack_slug="dan", provider="anthropic", model="m", target_words=1500
        ),
        outline=OutlineProposal(
            opening_hook="Your gadget betrayed you.",
            sections=[
                OutlineSection(id="s1", title="The Betrayal", brief="b1"),
                OutlineSection(id="s2", title="The Concept", brief="b2"),
                OutlineSection(id="s3", title="The Payoff", brief="b3"),
            ],
        ),
        sections=_sections(),
    )


def test_split_maps_headings_to_sections_in_order_without_heading_lines() -> None:
    doc = "## The Betrayal\nHiDock shipped your data.\n\n## The Concept\nKeep it local.\n\n## The Payoff\nYou own it."
    out = split_document(doc, _sections())
    assert out["s1"] == "HiDock shipped your data."
    assert out["s2"] == "Keep it local."
    assert out["s3"] == "You own it."
    # Heading lines are stripped — assemble_markdown re-adds the title.
    assert "##" not in out["s1"]


def test_split_folds_preamble_into_first_section() -> None:
    doc = "A stray lead paragraph.\n\n## The Betrayal\nBody one.\n\n## The Concept\nBody two.\n\n## The Payoff\nBody three."
    out = split_document(doc, _sections())
    assert out["s1"].startswith("A stray lead paragraph.")
    assert "Body one." in out["s1"]


def test_split_appends_overflow_headings_to_last_section() -> None:
    doc = (
        "## The Betrayal\nOne.\n\n## The Concept\nTwo.\n\n"
        "## The Payoff\nThree.\n\n## Bonus\nExtra content."
    )
    out = split_document(doc, _sections())
    assert "Three." in out["s3"]
    assert "Extra content." in out["s3"]  # 4th heading folded into the last section


def test_split_with_no_headings_dumps_into_first_section() -> None:
    out = split_document("Just one big blob, no headings.", _sections())
    assert out["s1"] == "Just one big blob, no headings."
    assert "s2" not in out


def test_render_document_prompt_lists_sections_and_forbids_repetition() -> None:
    rendered = _render_document_prompt(_draft())
    assert "## The Betrayal" in rendered
    assert "## The Payoff" in rendered
    assert "COMPLETE blog post" in rendered
    assert "NEVER restate" in rendered
    assert "Your gadget betrayed you." in rendered  # hook passed as do-not-repeat context


class _CompleteRecorder:
    name = "recorder"

    def __init__(self, output: str) -> None:
        self.prompt = ""
        self.output = output

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        self.prompt = prompt
        return LLMResponse(
            text=self.output, input_tokens=1, output_tokens=1, model=model, finish_reason="stop"
        )


@pytest.mark.asyncio
async def test_generate_document_returns_one_pass_output(tmp_path: Path) -> None:
    rec = _CompleteRecorder("## The Betrayal\nbody\n\n## The Concept\nbody\n\n## The Payoff\nbody")
    out = await generate_document(
        _draft(), _fake_pack(tmp_path), {"samples": []}, rec, model="m"
    )
    assert out.startswith("## The Betrayal")
    # Voice system prompt + all section titles reached the provider in one call.
    assert "Be brief." in rec.prompt
    assert "The Concept" in rec.prompt
