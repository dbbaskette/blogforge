from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

TTS_RATIONALE = (
    "This text will be read by a text-to-speech engine, and disruptive "
    "punctuation can produce confusing pauses or phrasing."
)
FACTUAL_RATIONALE = (
    "Unsupported material damages factual trust and makes attribution unreliable."
)
PRESERVATION_RATIONALE = (
    "This is a bounded edit and must not damage the approved article."
)
OUTPUT_RATIONALE = (
    "Downstream code parses this response, so extra or malformed content breaks the workflow."
)
CONTINUITY_RATIONALE = (
    "These sections form one continuous article, so repetition makes the argument restart."
)
VOICE_RATIONALE = (
    "The result must retain the author's recognizable voice instead of sounding templated."
)


@dataclass(frozen=True)
class PromptRule:
    instruction: str
    rationale: str

    def __post_init__(self) -> None:
        if not self.instruction.strip():
            raise ValueError("prompt rule instruction must not be blank")
        if not self.rationale.strip():
            raise ValueError("prompt rule rationale must not be blank")


def render_prompt_rules(
    rules: Sequence[PromptRule],
    *,
    bullet: bool = False,
) -> str:
    if bullet:
        return "\n".join(
            f"- Rule: {rule.instruction.strip()}\n"
            f"  Because: {rule.rationale.strip()}"
            for rule in rules
        )
    return "\n\n".join(
        f"Rule: {rule.instruction.strip()}\n"
        f"Because: {rule.rationale.strip()}"
        for rule in rules
    )
