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
    assert "OPENING section" in prompt
    assert "Hook sentence." in prompt


def test_render_section_prompt_marks_last_section() -> None:
    draft = _draft()
    prompt = _render_section_prompt(draft, draft.sections[2])
    assert "**Third**" in prompt
    assert "CLOSING section" in prompt


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


def test_section_prompt_omits_unwritten_prior_sections() -> None:
    """Empty preceding sections contribute no story-so-far block (nothing to
    continue from yet)."""
    draft = _draft()  # all sections empty
    prompt = _render_section_prompt(draft, draft.sections[1])
    assert "already been written" not in prompt


def test_first_section_warned_off_repeating_hook() -> None:
    draft = _draft()
    prompt = _render_section_prompt(draft, draft.sections[0])
    assert "do NOT repeat or paraphrase it" in prompt


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
