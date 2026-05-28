"""Draft pydantic model coerces legacy stage='idea' → 'research'."""
import pytest

from pencraft.drafts.models import Draft, IdeaInput


def _idea() -> IdeaInput:
    return IdeaInput(
        topic="t", pack_slug="dan", provider="anthropic", model="m", target_words=1500
    )


def test_legacy_idea_stage_in_body_coerces_to_research():
    draft = Draft.model_validate({"stage": "idea", "idea": _idea().model_dump()})
    assert draft.stage == "research"


def test_research_stage_passes_through_unchanged():
    draft = Draft.model_validate({"stage": "research", "idea": _idea().model_dump()})
    assert draft.stage == "research"


def test_outline_and_sections_unchanged():
    for stage in ("outline", "sections"):
        draft = Draft.model_validate({"stage": stage, "idea": _idea().model_dump()})
        assert draft.stage == stage


def test_unknown_stage_still_rejected():
    """The coercion shim is intentionally narrow — only "idea" is rewritten."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Draft.model_validate({"stage": "thinking", "idea": _idea().model_dump()})
