"""Tests for voice style distillation."""
from __future__ import annotations

from blogforge.voice.distill import _build_prompt, distill_style


def assert_paired(prompt: str, instruction: str, rationale_fragment: str) -> None:
    pair = f"Rule: {instruction}\nBecause: "
    assert pair in prompt
    assert rationale_fragment in prompt[prompt.index(pair):]


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


async def test_distill_returns_provider_markdown(monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "## Style\nShort sentences.")
    from blogforge.llm.registry import get_provider
    out = await distill_style(["x"], get_provider("anthropic", "k"), model="m")
    assert out == "## Style\nShort sentences."
