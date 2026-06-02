"""Headline lab: structured title/hook variants grounded in the draft."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, OutlineSection
from blogforge.generate.headlines import _build_prompt, generate_headlines

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


def _draft() -> Draft:
    return Draft(
        title="Why local-first wins",
        idea=IdeaInput(topic="local-first", pack_slug="dan", provider="anthropic", model="m"),
        outline=OutlineProposal(
            opening_hook="Your gadget betrayed you.",
            sections=[OutlineSection(id="s1", title="The Betrayal", brief="HiDock")],
        ),
    )


def test_build_prompt_grounds_in_draft_and_picks_kind() -> None:
    title_prompt = _build_prompt(_draft(), "title", 5)
    assert "alternative TITLES" in title_prompt
    assert "Why local-first wins" in title_prompt  # grounded in the topic
    assert "The Betrayal" in title_prompt  # outline included
    hook_prompt = _build_prompt(_draft(), "hook", 3)
    assert "OPENING HOOKS" in hook_prompt


@pytest.mark.asyncio
async def test_generate_headlines_parses_options(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv(
        "BLOGFORGE_MOCK_OUTPUT_JSON",
        json.dumps({"options": ["The Quiet Betrayal", "Who Owns Your Words?", "Local-First, Finally"]}),
    )
    from blogforge.llm.registry import get_provider

    provider = get_provider("anthropic", "sk-mock")
    out = await generate_headlines(
        _draft(), _fake_pack(tmp_path), {"samples": []}, provider, model="m", kind="title", n=5
    )
    assert out == ["The Quiet Betrayal", "Who Owns Your Words?", "Local-First, Finally"]


@pytest.mark.asyncio
async def test_generate_headlines_caps_to_n(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv(
        "BLOGFORGE_MOCK_OUTPUT_JSON", json.dumps({"options": ["a", "b", "c", "d", "e"]})
    )
    from blogforge.llm.registry import get_provider

    provider = get_provider("anthropic", "sk-mock")
    out = await generate_headlines(
        _draft(), _fake_pack(tmp_path), {"samples": []}, provider, model="m", kind="hook", n=2
    )
    assert out == ["a", "b"]
