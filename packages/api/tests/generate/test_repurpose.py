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

    def __init__(self, *outputs: str) -> None:
        self.prompt = ""
        self.prompts: list[str] = []
        self.outputs = list(outputs or ("repurposed",))

    async def complete(
        self, *, model: str, prompt: str, json_schema: dict[str, object] | None = None
    ) -> LLMResponse:
        self.prompt = prompt
        self.prompts.append(prompt)
        output = self.outputs[min(len(self.prompts) - 1, len(self.outputs) - 1)]
        return LLMResponse(
            text=output, input_tokens=1, output_tokens=1, model=model, finish_reason="stop"
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


def test_summary_and_extended_have_format_entries() -> None:
    assert FORMATS["summary"]["label"] == "Summarized version"
    assert FORMATS["extended"]["label"] == "Extended version"


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
    # Feed post: character-targeted, teaching, brand named.
    feed = _build_prompt("body", "linkedin")
    assert "1,300 and 1,600 characters" in feed
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
    rec = _CompleteRecorder("1/ A hook tweet")
    out = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        rec,
        model="m",
        body="# Title\n\nA full article about local-first software and why it matters.",
        fmt="x_thread",
    )
    assert out.text == "1/ A hook tweet"
    assert out.length is None
    assert "local-first software" in rec.prompt
    assert "Be brief." in rec.prompt  # voice system prompt folded in


@pytest.mark.asyncio
async def test_summary_uses_half_source_words_and_returns_metadata(tmp_path: Path) -> None:
    source = " ".join(f"source{i}" for i in range(200))
    output = " ".join(f"summary{i}" for i in range(100))
    rec = _CompleteRecorder(output)

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        rec,
        model="m",
        body=source,
        fmt="summary",
    )

    assert result.text == output
    assert result.length is not None
    assert result.length.metric == "words"
    assert (result.length.minimum, result.length.maximum) == (90, 110)
    assert result.length.actual == 100
    assert result.length.within_target is True
    assert result.length.correction_attempted is False
    assert "between 90 and 110 words" in rec.prompts[0]


@pytest.mark.asyncio
async def test_extended_uses_one_and_a_half_source_words(tmp_path: Path) -> None:
    source = " ".join(f"source{i}" for i in range(100))
    output = " ".join(f"extended{i}" for i in range(150))

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        _CompleteRecorder(output),
        model="m",
        body=source,
        fmt="extended",
    )

    assert result.length is not None
    assert (result.length.minimum, result.length.maximum) == (135, 165)
    assert result.length.actual == 150
    assert result.length.within_target is True


@pytest.mark.asyncio
async def test_out_of_range_result_retries_once(tmp_path: Path) -> None:
    source = " ".join(f"source{i}" for i in range(200))
    short = " ".join(f"short{i}" for i in range(20))
    corrected = " ".join(f"summary{i}" for i in range(100))
    rec = _CompleteRecorder(short, corrected)

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        rec,
        model="m",
        body=source,
        fmt="summary",
    )

    assert len(rec.prompts) == 2
    assert "20 words" in rec.prompts[1]
    assert "between 90 and 110 words" in rec.prompts[1]
    assert result.length is not None
    assert result.length.correction_attempted is True
    assert result.length.within_target is True
    assert result.text == corrected


@pytest.mark.asyncio
async def test_second_miss_is_returned_with_warning_metadata(tmp_path: Path) -> None:
    rec = _CompleteRecorder("too short", "still too short")

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        rec,
        model="m",
        body=" ".join(["source"] * 200),
        fmt="extended",
    )

    assert len(rec.prompts) == 2
    assert result.text == "still too short"
    assert result.length is not None
    assert result.length.correction_attempted is True
    assert result.length.within_target is False


@pytest.mark.asyncio
async def test_linkedin_uses_character_range(tmp_path: Path) -> None:
    output = "x" * 1300

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        _CompleteRecorder(output),
        model="m",
        body="source article",
        fmt="linkedin",
    )

    assert result.length is not None
    assert result.length.metric == "characters"
    assert (result.length.minimum, result.length.maximum) == (1300, 1600)
    assert result.length.actual == 1300
    assert result.length.within_target is True


@pytest.mark.parametrize(
    ("fmt", "source_words", "output_words", "minimum", "maximum", "within_target"),
    [
        ("summary", 200, 89, 90, 110, False),
        ("summary", 200, 90, 90, 110, True),
        ("summary", 200, 110, 90, 110, True),
        ("summary", 200, 111, 90, 110, False),
        ("extended", 100, 134, 135, 165, False),
        ("extended", 100, 135, 135, 165, True),
        ("extended", 100, 165, 135, 165, True),
        ("extended", 100, 166, 135, 165, False),
    ],
)
@pytest.mark.asyncio
async def test_word_length_boundaries_are_inclusive(
    tmp_path: Path,
    fmt: str,
    source_words: int,
    output_words: int,
    minimum: int,
    maximum: int,
    within_target: bool,
) -> None:
    source = " ".join(["source"] * source_words)
    output = " ".join(["result"] * output_words)
    recorder = _CompleteRecorder(output)

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        recorder,
        model="m",
        body=source,
        fmt=fmt,  # type: ignore[arg-type]
    )

    assert result.length is not None
    assert (result.length.minimum, result.length.maximum) == (minimum, maximum)
    assert result.length.actual == output_words
    assert result.length.within_target is within_target
    assert len(recorder.prompts) == (1 if within_target else 2)


@pytest.mark.parametrize(
    ("characters", "within_target"),
    [(1299, False), (1300, True), (1600, True), (1601, False)],
)
@pytest.mark.asyncio
async def test_linkedin_character_boundaries_are_inclusive(
    tmp_path: Path, characters: int, within_target: bool
) -> None:
    output = "x" * characters
    recorder = _CompleteRecorder(output)

    result = await repurpose(
        _draft(),
        _fake_pack(tmp_path),
        {"samples": []},
        recorder,
        model="m",
        body="source article",
        fmt="linkedin",
    )

    assert result.length is not None
    assert result.length.actual == characters
    assert result.length.within_target is within_target
    assert len(recorder.prompts) == (1 if within_target else 2)
