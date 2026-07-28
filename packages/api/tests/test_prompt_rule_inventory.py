from __future__ import annotations

from pathlib import Path

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


def test_python_prompt_sources_use_structured_rules() -> None:
    for relative in PYTHON_PROMPT_SOURCES:
        text = (ROOT / relative).read_text(encoding="utf-8")
        assert "PromptRule" in text, relative


def test_static_prompt_sources_pair_rules_and_reasons() -> None:
    for relative in STATIC_PROMPT_SOURCES:
        text = (ROOT / relative).read_text(encoding="utf-8")
        assert "Rule:" in text, relative
        assert "Because:" in text, relative
        assert text.count("Rule:") == text.count("Because:"), relative
