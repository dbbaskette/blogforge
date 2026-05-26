from __future__ import annotations

from pencraft.drafts.models import Draft, IdeaInput, OutlineProposal, OutlineSection, Section
from pencraft.generate.section import _render_section_prompt


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
    assert "Open and close mid-thought" in prompt
