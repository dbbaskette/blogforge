from __future__ import annotations

import re
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
STYLE_GUIDE_RATIONALE = (
    "This rule captures the author's approved and recognizable voice."
)
FORMAT_INSTRUCTION_RATIONALE = (
    "The selected publishing surface requires this instruction."
)

_IMPERATIVE_PREFIXES = (
    "always",
    "ask",
    "attribute",
    "avoid",
    "base",
    "be",
    "break",
    "change",
    "close",
    "copy",
    "cut",
    "do not",
    "don't",
    "emit",
    "end",
    "ensure",
    "exclude",
    "flag",
    "focus",
    "follow",
    "give",
    "ground",
    "include",
    "keep",
    "leave",
    "limit",
    "list",
    "loosen",
    "make",
    "match",
    "must",
    "never",
    "no",
    "only",
    "open",
    "output",
    "place",
    "prefer",
    "preserve",
    "read",
    "remove",
    "replace",
    "return",
    "rewrite",
    "set",
    "should",
    "skip",
    "start",
    "state",
    "use",
    "vary",
    "write",
)
_IMPERATIVE_PATTERN = "|".join(
    re.escape(prefix) for prefix in sorted(_IMPERATIVE_PREFIXES, key=len, reverse=True)
)
_IMPERATIVE_RE = re.compile(rf"^(?:{_IMPERATIVE_PATTERN})\b", re.IGNORECASE)
_IMPERATIVE_SPLIT_RE = re.compile(
    rf"(?<=[.!?])\s+(?=(?:{_IMPERATIVE_PATTERN})\b)",
    re.IGNORECASE,
)
_CONTENT_LINE_RE = re.compile(
    r"^(?P<indent>\s*)(?:(?P<marker>[-*+]|\d+[.)])\s+)?(?P<content>\S.*)$"
)
_RULE_LINE_RE = re.compile(
    r"^(?P<indent>\s*)(?:(?P<marker>[-*+]|\d+[.)])\s+)?"
    r"Rule:\s*(?P<instruction>\S.*)$"
)
_BECAUSE_LINE_RE = re.compile(r"^\s*Because:\s+\S")


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


def normalize_instruction_asset(
    text: str,
    *,
    default_rationale: str,
) -> str:
    """Pair imperative Markdown lines with operational rationales.

    Headings, prose observations, examples, block quotes, and fenced code stay
    untouched. Existing adjacent ``Rule:`` / ``Because:`` pairs are copied
    verbatim. Bare imperative sentences become individual pairs so legacy
    style guides and custom format assets cannot bypass the prompt-rule
    contract.
    """
    if not text:
        return text

    lines = text.splitlines()
    normalized: list[str] = []
    in_fence = False
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            in_fence = not in_fence
            normalized.append(line)
            index += 1
            continue
        if in_fence or stripped.startswith(">"):
            normalized.append(line)
            index += 1
            continue

        rule_match = _RULE_LINE_RE.match(line)
        if rule_match is not None:
            if index + 1 < len(lines) and _BECAUSE_LINE_RE.match(lines[index + 1]):
                normalized.extend((line, lines[index + 1]))
                index += 2
                continue
            normalized.extend(
                _render_asset_rule(
                    rule_match.group("indent"),
                    rule_match.group("marker"),
                    rule_match.group("instruction"),
                    default_rationale,
                )
            )
            index += 1
            continue

        content_match = _CONTENT_LINE_RE.match(line)
        if content_match is None:
            normalized.append(line)
            index += 1
            continue

        content = content_match.group("content")
        instructions = _split_imperative_sentences(content)
        if not instructions:
            normalized.append(line)
            index += 1
            continue

        for instruction in instructions:
            normalized.extend(
                _render_asset_rule(
                    content_match.group("indent"),
                    content_match.group("marker"),
                    instruction,
                    default_rationale,
                )
            )
        index += 1

    result = "\n".join(normalized)
    if text.endswith(("\n", "\r")):
        result += "\n"
    return result


def _split_imperative_sentences(text: str) -> list[str]:
    if text.lower().startswith("use of "):
        return []
    parts = _IMPERATIVE_SPLIT_RE.split(text)
    if not parts or any(_IMPERATIVE_RE.match(part) is None for part in parts):
        return []
    return [part.strip() for part in parts]


def _render_asset_rule(
    indent: str,
    marker: str | None,
    instruction: str,
    default_rationale: str,
) -> tuple[str, str]:
    rationale = _rationale_for_instruction(instruction, default_rationale)
    if marker is None:
        return (
            f"{indent}Rule: {instruction.strip()}",
            f"{indent}Because: {rationale}",
        )
    reason_indent = " " * (len(marker) + 1)
    return (
        f"{indent}{marker} Rule: {instruction.strip()}",
        f"{indent}{reason_indent}Because: {rationale}",
    )


def _rationale_for_instruction(instruction: str, default_rationale: str) -> str:
    lowered = instruction.lower()
    if any(term in lowered for term in ("dash", "hyphen", "punctuation")):
        return TTS_RATIONALE
    if "opening answer" in lowered:
        return (
            "The approved answer-first opening must remain stable for GEO scoring "
            "and reader continuity."
        )
    if (
        any(
            term in lowered
            for term in (
                "fact",
                "invent",
                "link",
                "name",
                "number",
                "quotation",
                "quote",
                "source",
                "statistic",
                "url",
            )
        )
        and _IMPERATIVE_RE.match(instruction) is not None
    ):
        return (
            "The instruction preserves factual accuracy and reliable attribution "
            "in the approved content."
        )
    if any(term in lowered for term in ("json", "schema")):
        return OUTPUT_RATIONALE
    return default_rationale
