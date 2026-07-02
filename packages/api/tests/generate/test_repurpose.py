"""Repurpose composes a voice prompt over the whole article and returns the
provider's channel-specific rewrite."""

from __future__ import annotations

from pathlib import Path

import pytest

from blogforge.drafts.models import Draft, IdeaInput
from blogforge.generate.repurpose import FORMATS, _build_prompt, repurpose
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
    name = "recorder"

    def __init__(self, output: str = "repurposed") -> None:
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


def test_every_format_has_a_label_and_directive() -> None:
    for spec in FORMATS.values():
        assert spec["label"]
        assert spec["directive"]


def test_build_prompt_embeds_article_and_channel_directive() -> None:
    prompt = _build_prompt("The whole article body here.", "x_thread")
    assert "The whole article body here." in prompt
    assert "280 characters" in prompt  # x_thread directive
    assert "don't invent facts" in prompt


def test_linkedin_feed_and_article_formats_carry_geo_guardrails() -> None:
    # Feed post: capped short, teaching, brand named.
    feed = FORMATS["linkedin"]["directive"]
    assert "50-299 words" in feed
    assert "brand" in feed.lower()
    # Pulse article: long-form sweet spot (get cited far more than feed posts).
    article = FORMATS["linkedin_article"]
    assert "800-1,200 words" in article["directive"]
    assert "Pulse" in article["label"]


@pytest.mark.asyncio
async def test_repurpose_returns_provider_output(tmp_path: Path) -> None:
    rec = _CompleteRecorder(output="1/ A hook tweet")
    out = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        rec,
        model="m",
        body="# Title\n\nA full article about local-first software and why it matters.",
        fmt="x_thread",
    )
    assert out == "1/ A hook tweet"
    assert "local-first software" in rec.prompt
    assert "Be brief." in rec.prompt  # voice system prompt folded in
