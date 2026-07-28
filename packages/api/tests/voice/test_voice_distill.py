"""Tests for voice style distillation."""
from __future__ import annotations

from blogforge.voice.distill import _build_prompt, distill_style


def assert_paired(prompt: str, instruction: str, rationale_fragment: str) -> None:
    pair = f"Rule: {instruction}\nBecause: "
    assert pair in prompt
    reason = prompt[prompt.index(pair) + len(pair):].splitlines()[0]
    assert rationale_fragment in reason


def test_prompt_includes_samples_and_asks_for_style_guide():
    p = _build_prompt(["Sample one.", "Sample two."])
    assert "Sample one." in p and "Sample two." in p
    assert "style guide" in p.lower()


def test_distill_prompt_extracts_structured_traits():
    from blogforge.voice.distill import _build_prompt
    p = _build_prompt(["sample text here"])
    for trait in ("open", "transition", "opinion", "anecdote", "humor"):
        assert trait in p.lower()
    assert_paired(
        p,
        "Write guidance an AI can follow to imitate the author's voice.",
        "recognizable voice",
    )
    assert_paired(
        p,
        "Format every model-facing style instruction as an adjacent `Rule:` and "
        "`Because:` pair.",
        "portable guide must explain why each instruction matters",
    )
    assert_paired(
        p,
        "Keep descriptive headings, observations, and examples as context rather "
        "than labeling them as rules.",
        "Only actual instructions require rationale metadata",
    )
    assert_paired(
        p,
        "Do not copy the prompt's own `Rule:` or `Because:` labels, instructions, "
        "or rationales verbatim into the style guide; use those labels only for "
        "extracted style rules.",
        "guide must contain only the author's extracted voice guidance",
    )


async def test_distill_returns_provider_markdown(monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "## Style\nShort sentences.")
    from blogforge.llm.registry import get_provider
    out = await distill_style(["x"], get_provider("anthropic", "k"), model="m")
    assert out == "## Style\nShort sentences."


async def test_distill_normalizes_bare_generated_style_rules(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "## Diction\nWrite plainly.")
    from blogforge.llm.registry import get_provider

    out = await distill_style(["x"], get_provider("anthropic", "k"), model="m")

    assert_paired(
        out,
        "Write plainly.",
        "approved and recognizable voice",
    )
