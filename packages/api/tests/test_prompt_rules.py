from __future__ import annotations

import pytest

from blogforge.prompt_rules import TTS_RATIONALE, PromptRule, render_prompt_rules


def test_renders_adjacent_rule_and_reason() -> None:
    rendered = render_prompt_rules(
        [
            PromptRule("Do not use em dashes.", TTS_RATIONALE),
            PromptRule("Return only JSON.", "Downstream code parses this response."),
        ]
    )
    assert rendered == (
        "Rule: Do not use em dashes.\n"
        f"Because: {TTS_RATIONALE}\n\n"
        "Rule: Return only JSON.\n"
        "Because: Downstream code parses this response."
    )


def test_bullet_renderer_keeps_each_reason_with_its_rule() -> None:
    rendered = render_prompt_rules(
        [PromptRule("Preserve every quotation.", "The edit must retain the factual record.")],
        bullet=True,
    )
    assert rendered == (
        "- Rule: Preserve every quotation.\n"
        "  Because: The edit must retain the factual record."
    )


@pytest.mark.parametrize(
    ("instruction", "rationale", "message"),
    [
        (" ", "reason", "prompt rule instruction must not be blank"),
        ("instruction", "\n", "prompt rule rationale must not be blank"),
    ],
)
def test_rejects_blank_values(instruction: str, rationale: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        PromptRule(instruction, rationale)


def test_tts_rationale_describes_guaranteed_consuming_surface() -> None:
    assert "will be read by a text-to-speech engine" in TTS_RATIONALE
    assert "confusing pauses or phrasing" in TTS_RATIONALE
