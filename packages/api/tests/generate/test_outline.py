from __future__ import annotations

import json
from pathlib import Path

import pytest

from blogforge.drafts.models import IdeaInput, OutlineProposal
from blogforge.generate.ideation import IDEATION_SYSTEM_BLOCK
from blogforge.generate.outline import _render_outline_prompt, _section_budget, propose_outline

_CANNED = {
    "opening_hook": "Most agents are demos.",
    "sections": [
        {"id": "s1", "title": "State of agents", "brief": "Where the hype lives vs. ships."},
        {"id": "s2", "title": "What works", "brief": "Reliability and observability."},
    ],
    "estimated_words": 1200,
}


def test_render_outline_prompt_includes_topic_and_bullets() -> None:
    idea = IdeaInput(
        topic="AI agents",
        bullets=["Most break in prod", "Small wins survive"],
        pack_slug="dan",
        provider="anthropic",
        model="claude-sonnet-4-6",
    )
    rendered = _render_outline_prompt(idea)
    assert "AI agents" in rendered
    assert "Most break in prod" in rendered
    assert "Small wins survive" in rendered


def test_section_budget_scales_to_length_and_stays_in_bounds() -> None:
    # Short post → few sections; long post → more, but clamped to <=7.
    assert _section_budget(800) == (3, 4, 267)
    lo, hi, wps = _section_budget(1500)
    assert (lo, hi) == (3, 5) and 300 <= wps <= 400
    lo_long, hi_long, _ = _section_budget(4000)
    assert hi_long <= 8 and lo_long >= 6  # capped, doesn't sprawl


def test_outline_prompt_demands_a_nonoverlapping_progression() -> None:
    idea = IdeaInput(topic="X", pack_slug="dan", provider="anthropic", model="m", target_words=1500)
    rendered = _render_outline_prompt(idea)
    assert "ONE continuous argument" in rendered
    assert "PROGRESSION" in rendered
    assert "NO two sections" in rendered
    assert "3–5 sections" in rendered  # adaptive count for 1500 words


def test_ideation_block_enforces_single_argument() -> None:
    assert "ONE continuous argument" in IDEATION_SYSTEM_BLOCK
    assert "NO two sections" in IDEATION_SYSTEM_BLOCK
    assert "5-9" not in IDEATION_SYSTEM_BLOCK  # the old over-sectioning is gone


@pytest.mark.asyncio
async def test_propose_outline_with_mock_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT_JSON", json.dumps(_CANNED))

    from blogforge.llm.registry import get_provider

    provider = get_provider("anthropic", "sk-mock")

    idea = IdeaInput(
        topic="X",
        pack_slug="dan",
        provider="anthropic",
        model="mock-1",
    )
    # Fake pack root + minimal manifest
    pack_root = tmp_path / "fakepack"
    pack_root.mkdir()
    (pack_root / "stylepack.yaml").write_text("""
spec_version: '1.0'
pack:
  slug: dan
  name: Dan
  version: '1.0'
  author: Dan
persona:
  identity: x
  one_line: y
""")
    (pack_root / "style-guide.md").write_text("Be brief.\n")
    manifest: dict[str, object] = {"samples": []}

    proposal = await propose_outline(
        idea, pack_root, manifest, provider, model="mock-1",
    )
    assert isinstance(proposal, OutlineProposal)
    assert proposal.opening_hook == "Most agents are demos."
    assert len(proposal.sections) == 2
