"""Inline AI transform composes a voice prompt for a selected passage and
returns the provider's rewrite. Mirrors the section-prompt recorder pattern."""
from __future__ import annotations

from pathlib import Path

import pytest

from blogforge.drafts.models import Draft, IdeaInput
from blogforge.generate.inline import _build_user_prompt, transform_text
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


class _CompleteRecorder:
    """Captures the prompt handed to .complete() and returns canned text."""

    name = "recorder"

    def __init__(self, output: str = "rewritten passage") -> None:
        self.prompt = ""
        self.output = output

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        self.prompt = prompt
        return LLMResponse(
            text=self.output, input_tokens=1, output_tokens=1, model=model, finish_reason="stop"
        )


def _draft() -> Draft:
    return Draft(
        title="Test Post",
        idea=IdeaInput(topic="A topic", pack_slug="dan", provider="anthropic", model="m"),
    )


def test_build_user_prompt_embeds_passage_and_action() -> None:
    prompt = _build_user_prompt("the quick brown fox", "shorten", "")
    assert "the quick brown fox" in prompt
    assert "fewer words" in prompt  # the 'shorten' directive
    assert "Return ONLY the final rewritten passage" in prompt


def test_build_user_prompt_custom_uses_instruction() -> None:
    prompt = _build_user_prompt("some text", "custom", "make it sound angrier")
    assert "make it sound angrier" in prompt


@pytest.mark.asyncio
async def test_transform_text_returns_provider_rewrite(tmp_path: Path) -> None:
    rec = _CompleteRecorder(output="A tighter line.")
    out = await transform_text(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        rec,
        model="m",
        text="A line that is rather too long and could be tightened considerably.",
        action="shorten",
    )
    assert out == "A tighter line."
    # The selected passage and the voice system prompt both reach the provider.
    assert "could be tightened" in rec.prompt
    assert "Be brief." in rec.prompt  # style-guide folded in via compose_prompt
