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
    assert "Rule: Use only facts present in the source article." in prompt
    assert "Because: Repurposed content must not introduce unsupported claims" in prompt
    assert (
        "Rule: Do not copy the `Rule` or `Because` labels or their rationales into "
        "the repurposed content."
    ) in prompt


def test_linkedin_feed_and_article_formats_carry_geo_guardrails() -> None:
    # Feed post: capped short, teaching, brand named.
    feed = _build_prompt("body", "linkedin")
    assert "50 and 299 words" in feed
    assert "brand" in feed.lower()
    # Pulse article: long-form sweet spot (get cited far more than feed posts).
    article = _build_prompt("body", "linkedin_article")
    assert "800 and 1,200 words" in article
    assert "Pulse" in FORMATS["linkedin_article"]["label"]


@pytest.mark.parametrize(
    ("fmt", "instruction", "rationale"),
    [
        (
            "x_thread",
            "Make each tweet stand alone.",
            "Readers encounter individual tweets out of context.",
        ),
        (
            "linkedin",
            "Do not pad the feed post to look longer.",
            "Short LinkedIn posts can still be useful and cited",
        ),
        (
            "linkedin_article",
            "Keep the article original and first-hand.",
            "First-hand detail makes the article more credible",
        ),
        (
            "newsletter",
            "End with an implicit 'read more'.",
            "A subtle closing directs attention to the article",
        ),
        (
            "tldr",
            "Do not add fluff.",
            "Readers choose a TL;DR for the article's essential information.",
        ),
        ("meta_description", "Do not use clickbait.", "Misleading search copy damages trust"),
        ("email", "Link the reader to the post.", "Recipients need a path to the full article."),
    ],
)
def test_every_channel_renders_an_adjacent_rule_and_reason(
    fmt: str, instruction: str, rationale: str
) -> None:
    prompt = _build_prompt("body", fmt)  # type: ignore[arg-type]
    assert f"Rule: {instruction}\nBecause: {rationale}" in prompt


def _assert_rule_pair(prompt: str, instruction: str, rationale: str) -> None:
    assert f"Rule: {instruction}\nBecause: {rationale}" in prompt


def test_email_and_linkedin_rules_keep_split_requirements() -> None:
    thread = _build_prompt("body", "x_thread")
    _assert_rule_pair(
        thread,
        "Make each tweet stand alone.",
        "Readers encounter individual tweets out of context.",
    )
    _assert_rule_pair(
        thread,
        "Keep each tweet under 280 characters.",
        "The platform enforces its character limit.",
    )
    email = _build_prompt("body", "email")
    _assert_rule_pair(
        email,
        "Explain why the post matters.",
        "Recipients need a reason to care before they decide to read more.",
    )
    _assert_rule_pair(
        email,
        "Link the reader to the post.",
        "Recipients need a path to the full article.",
    )
    _assert_rule_pair(
        email,
        "Use a warm, direct tone.",
        "A personal tone makes an announcement email feel written for its recipient.",
    )
    _assert_rule_pair(
        email,
        "Use one clear call to action.",
        "A focused email makes the next step easy for readers to act on.",
    )
    article = _build_prompt("body", "linkedin_article")
    _assert_rule_pair(
        article,
        "Name the product or brand explicitly.",
        "Clear attribution keeps the subject identifiable when the article is cited or shared.",
    )
    _assert_rule_pair(
        article,
        "Keep the article original and first-hand.",
        "First-hand detail makes the article more credible than a generic repost.",
    )


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
