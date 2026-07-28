from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1] / "blogforge"

PYTHON_PROMPT_SOURCES = (
    "prompt_rules.py",
    "voice/compose.py",
    "voice/distill.py",
    "voice/enforce.py",
    "voice/fingerprint.py",
    "voice/guide.py",
    "voice/linkedin_import.py",
    "generate/builtin_formats.py",
    "generate/claims.py",
    "generate/geo.py",
    "generate/headlines.py",
    "generate/hero.py",
    "generate/humanize.py",
    "generate/ideation.py",
    "generate/inline.py",
    "generate/repurpose.py",
    "generate/section.py",
    "generate/suggest.py",
    "generate/topics.py",
)

STATIC_PROMPT_SOURCES = (
    "voice/assets/ai-tells/patterns.md",
    "voice/assets/humanize/lenses.md",
    "voice/assets/writing-baseline.md",
    "generate/prompts/document.j2",
    "generate/prompts/outline.j2",
    "generate/prompts/section.j2",
    "generate/prompts/section_revise.j2",
)

PROMPT_RULE_DISCOVERY_EXCLUSIONS: frozenset[str] = frozenset()


def _assert_static_pairs_are_adjacent(text: str, relative: str) -> None:
    lines = text.splitlines()
    rule_indexes: set[int] = set()
    reason_indexes: set[int] = set()
    for index, line in enumerate(lines):
        match = re.match(r"^(?P<indent>\s*)(?P<bullet>[-*]\s+)?Rule:\s+\S", line)
        if match is not None:
            rule_indexes.add(index)
            assert index + 1 < len(lines), f"{relative}:{index + 1}: rule has no reason"
            indent = match.group("indent")
            reason_prefix = (
                f"{indent}  Because: " if match.group("bullet") else f"{indent}Because: "
            )
            assert lines[index + 1].startswith(reason_prefix), (
                f"{relative}:{index + 1}: reason is not adjacent to rule"
            )

        if re.match(r"^\s*Because:\s+\S", line):
            reason_indexes.add(index)

    assert rule_indexes, relative
    assert reason_indexes, relative
    assert reason_indexes == {index + 1 for index in rule_indexes}, relative


def test_python_prompt_sources_use_structured_rules() -> None:
    for relative in PYTHON_PROMPT_SOURCES:
        text = (ROOT / relative).read_text(encoding="utf-8")
        assert "PromptRule" in text, relative


def test_prompt_rule_module_inventory_covers_production_uses() -> None:
    discovered = {
        path.relative_to(ROOT).as_posix()
        for prompt_root in (ROOT / "voice", ROOT / "generate")
        for path in prompt_root.rglob("*.py")
        if "PromptRule" in path.read_text(encoding="utf-8")
    }
    expected = set(PYTHON_PROMPT_SOURCES) - {"prompt_rules.py"}
    assert discovered - PROMPT_RULE_DISCOVERY_EXCLUSIONS == expected


def test_static_prompt_sources_pair_rules_and_reasons() -> None:
    for relative in STATIC_PROMPT_SOURCES:
        text = (ROOT / relative).read_text(encoding="utf-8")
        _assert_static_pairs_are_adjacent(text, relative)


def test_static_pair_check_rejects_equal_but_nonadjacent_counts() -> None:
    mismatched = (
        "Rule: Preserve the facts.\n"
        "Context between the rule and its rationale.\n"
        "Because: The factual record must remain accurate.\n"
    )
    with pytest.raises(AssertionError, match="reason is not adjacent"):
        _assert_static_pairs_are_adjacent(mismatched, "fixture.md")
