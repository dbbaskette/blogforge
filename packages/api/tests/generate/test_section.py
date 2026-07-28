from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, OutlineSection, Section
from blogforge.generate.section import _render_section_prompt, stream_section
from blogforge.llm.base import StreamChunk

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


class _PromptRecorder:
    """Captures the prompt handed to .stream() for assertions."""

    name = "recorder"

    def __init__(self) -> None:
        self.prompt = ""

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        self.prompt = prompt
        yield StreamChunk(delta="ok")


def _draft() -> Draft:
    return Draft(
        title="Test Post",
        idea=IdeaInput(
            topic="A topic",
            pack_slug="dan",
            provider="anthropic",
            model="claude-sonnet-4-6",
            target_words=1200,
        ),
        outline=OutlineProposal(
            opening_hook="Hook sentence.",
            sections=[
                OutlineSection(id="s1", title="First", brief="b1"),
                OutlineSection(id="s2", title="Second", brief="b2"),
                OutlineSection(id="s3", title="Third", brief="b3"),
            ],
        ),
        sections=[
            Section(id="s1", title="First", brief="b1"),
            Section(id="s2", title="Second", brief="b2"),
            Section(id="s3", title="Third", brief="b3"),
        ],
    )


def test_render_section_prompt_marks_current_first_section() -> None:
    draft = _draft()
    prompt = _render_section_prompt(draft, draft.sections[0])
    assert "**First**" in prompt
    assert "Establish the conflict" in prompt
    assert "Hook sentence." in prompt
    assert (
        "Rule: Write flowing Markdown prose.\nBecause: The generated body must read naturally "
        "inside the article."
    ) in prompt
    assert (
        "Rule: Do not include the section title as a heading.\nBecause: The renderer adds "
        "the heading"
    ) in prompt
    assert (
        "Rule: Use the author's voice and never use banished words or phrases.\nBecause: "
        "This section must sound like part of the same authored post."
    ) in prompt


def test_render_section_prompt_marks_last_section() -> None:
    draft = _draft()
    prompt = _render_section_prompt(draft, draft.sections[2])
    assert "**Third**" in prompt
    assert "Land the argument" in prompt


def test_render_section_prompt_middle_section() -> None:
    draft = _draft()
    prompt = _render_section_prompt(draft, draft.sections[1])
    assert "**Second**" in prompt
    assert "Pick up the thread from the previous section" in prompt


def test_section_prompt_threads_prior_prose_for_continuity() -> None:
    """A section sees the already-written prose of the sections before it, plus
    the briefs of the sections after it, so it continues one coherent piece."""
    draft = _draft()
    draft.sections[0].content_md = "The HiDock betrayal is where this starts."
    draft.sections[0].status = "ready"
    prompt = _render_section_prompt(draft, draft.sections[1])
    # Story-so-far carries section one's actual prose, not just its title.
    assert "The HiDock betrayal is where this starts." in prompt
    assert "already been written" in prompt
    # What's-next lists the later section by title so this one doesn't pre-empt it.
    assert "Third" in prompt
    # And the single-coherent-piece framing is present.
    assert "SINGLE, continuous blog post" in prompt
    assert (
        "Rule: Do not cover the ground reserved for later sections.\nBecause: Future "
        "sections need their own distinct contribution"
    ) in prompt
    assert (
        "Rule: Do not re-introduce the topic, restate earlier points, or reuse earlier "
        "phrasing, metaphors, or examples.\nBecause: The reader has already read"
    ) in prompt


def test_section_prompt_omits_unwritten_prior_sections() -> None:
    """Empty preceding sections contribute no story-so-far block (nothing to
    continue from yet)."""
    draft = _draft()  # all sections empty
    prompt = _render_section_prompt(draft, draft.sections[1])
    assert "already been written" not in prompt


def test_first_section_warned_off_repeating_hook() -> None:
    draft = _draft()
    prompt = _render_section_prompt(draft, draft.sections[0])
    assert "without repeating or paraphrasing the opening hook" in prompt


@pytest.mark.asyncio
async def test_stream_section_appends_instruction(tmp_path: Path) -> None:
    """A guided-regen instruction becomes an explicit revision directive."""
    draft = _draft()
    rec = _PromptRecorder()
    chunks = [
        c
        async for c in stream_section(
            draft,
            draft.sections[0],
            _fake_pack(tmp_path),
            {"samples": []},
            rec,
            model="m",
            instruction="make it punchier",
        )
    ]
    assert [c.delta for c in chunks] == ["ok"]
    assert "REVISION DIRECTIVE" in rec.prompt
    assert "make it punchier" in rec.prompt
    assert (
        "Rule: Follow the author's revision instruction when writing this section.\nBecause: "
        "The author expects this fresh draft to address the requested change."
    ) in rec.prompt
    assert (
        "Rule: Stay in the author's voice.\nBecause: A regenerated empty section must still "
        "match the rest of the post."
    ) in rec.prompt


@pytest.mark.asyncio
async def test_stream_section_no_instruction_has_no_directive(tmp_path: Path) -> None:
    draft = _draft()
    rec = _PromptRecorder()
    [
        c
        async for c in stream_section(
            draft,
            draft.sections[0],
            _fake_pack(tmp_path),
            {"samples": []},
            rec,
            model="m",
        )
    ]
    assert "REVISION DIRECTIVE" not in rec.prompt


@pytest.mark.asyncio
async def test_notes_on_existing_section_do_targeted_edit(tmp_path: Path) -> None:
    """Notes on a section that already has prose trigger a surgical edit: the
    model is handed the current text and told to change only what's needed,
    leaving the rest verbatim — not a full rewrite from the brief."""
    draft = _draft()
    draft.sections[1].content_md = (
        "The first paragraph should stay exactly as it is.\n\n"
        "The second paragraph needs a concrete statistic."
    )
    draft.sections[1].status = "ready"
    rec = _PromptRecorder()
    [
        c
        async for c in stream_section(
            draft,
            draft.sections[1],
            _fake_pack(tmp_path),
            {"samples": []},
            rec,
            model="m",
            instruction="add a concrete number to the second paragraph",
        )
    ]
    # The current section text is in the prompt, so the edit can be surgical.
    assert "The first paragraph should stay exactly as it is." in rec.prompt
    assert "The second paragraph needs a concrete statistic." in rec.prompt
    # Minimal-edit framing + the author's note are present…
    assert "SURGICAL" in rec.prompt
    assert "VERBATIM" in rec.prompt
    assert "add a concrete number to the second paragraph" in rec.prompt
    assert (
        "Rule: Reproduce every part the note does not require changing VERBATIM.\n"
        "Because: BlogForge needs a bounded edit that preserves the approved"
    ) in rec.prompt
    assert (
        "Rule: Do not re-introduce the topic or repeat points made in other sections.\n"
        "Because: The revised section must remain a continuous part of the existing article."
    ) in rec.prompt
    assert (
        "Rule: Keep the section's length and shape unless the note requires otherwise.\n"
        "Because: The edit should preserve the approved section structure."
    ) in rec.prompt
    assert (
        "Rule: Return the complete revised section as Markdown prose, with only the necessary "
        "changes.\nBecause: The response replaces the current section directly in the editor."
    ) in rec.prompt
    # …and it must NOT fall back to the write-from-scratch directive.
    assert "REVISION DIRECTIVE" not in rec.prompt


@pytest.mark.asyncio
async def test_notes_on_empty_section_write_from_scratch(tmp_path: Path) -> None:
    """With no existing prose there's nothing to preserve — the note folds into
    the from-scratch write via the revision directive, not a surgical edit."""
    draft = _draft()  # all sections empty
    rec = _PromptRecorder()
    [
        c
        async for c in stream_section(
            draft,
            draft.sections[0],
            _fake_pack(tmp_path),
            {"samples": []},
            rec,
            model="m",
            instruction="make it punchier",
        )
    ]
    assert "REVISION DIRECTIVE" in rec.prompt
    assert "SURGICAL" not in rec.prompt
