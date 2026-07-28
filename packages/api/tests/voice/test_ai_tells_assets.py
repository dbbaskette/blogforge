"""Pin the 2026 research refresh of the universal AI-tell assets."""
from importlib import resources

from blogforge.voice.ai_tells import load_ai_tells, parsed_patterns


def _asset(name: str) -> str:
    return resources.files("blogforge.voice").joinpath(f"assets/{name}").read_text(encoding="utf-8")


def _assert_paired_bullets(asset: str) -> None:
    lines = asset.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("- Rule: "):
            assert index + 1 < len(lines)
            assert lines[index + 1].startswith("  Because: ")
            continue
        if line.startswith("  Because: "):
            continue
        assert not line.startswith("- "), f"unpaired instruction bullet: {line}"


def test_new_words_added_and_false_positives_removed() -> None:
    words = {w.lower() for w in load_ai_tells().words}
    for added in ("plethora", "ever-evolving", "fast-paced", "burgeoning",
                  "quintessential", "unwavering", "unparalleled", "demystify",
                  "unveil", "hallmark"):
        assert added in words, f"missing new word: {added}"
    for removed in ("dynamic", "navigate", "foster", "facilitate", "versatile", "vivid"):
        assert removed not in words, f"false-positive word still banished: {removed}"


def test_new_phrases_added() -> None:
    phrases = {p.lower() for p in load_ai_tells().phrases}
    for added in ("gone are the days", "at the end of the day", "in a nutshell",
                  "picture this", "without further ado", "poised to",
                  "crucial role in shaping", "treasure trove", "here's the kicker"):
        assert added in phrases, f"missing new phrase: {added}"


def test_connective_openers_unbanned() -> None:
    starters = {s.lower() for s in load_ai_tells().sentence_starters}
    for removed in ("therefore", "thus", "meanwhile", "indeed"):
        assert removed not in starters, f"normal connective still forbidden: {removed}"
    assert "moreover" in starters  # the stacking-tell core stays


def test_new_patterns_present() -> None:
    pats = load_ai_tells().patterns
    for marker in ("Bold-label list scaffolding", "Framing sandwich",
                   "Both-sides hedging", "future-outlook coda",
                   "Audience bracketing", "Dictionary lead",
                   "paragraph-level uniformity", "Knowledge-cutoff residue",
                   "Colon-subtitle headlines"):
        assert marker.lower() in pats.lower(), f"missing pattern: {marker}"


def test_instruction_assets_pair_every_rule_with_a_reason() -> None:
    baseline = _asset("writing-baseline.md")
    patterns = _asset("ai-tells/patterns.md")
    lenses = _asset("humanize/lenses.md")
    for asset in (baseline, patterns, lenses):
        _assert_paired_bullets(asset)
    assert "Rule: Do not use em dashes or en dashes." in patterns
    assert "Because: This text will be read by a text-to-speech engine" in patterns
    assert (
        "Rule: Change wording, rhythm, and stance only.\n"
        "Because: Humanize is a prose edit"
    ) in lenses
    assert (
        "Rule: Never invent, drop, or alter a fact, number, name, quotation, or link.\n"
        "Because: Humanization must preserve the article's factual record"
    ) in lenses
    assert (
        "Rule: Never rewrite the article's opening answer sentence.\n"
        "Because: GEO relies on the approved answer-first opening"
    ) in lenses


def test_pattern_parser_accepts_rationale_backed_and_legacy_bullets(monkeypatch) -> None:
    monkeypatch.setattr(
        "blogforge.voice.ai_tells.load_ai_tells",
        lambda: type("Tells", (), {"patterns": (
            "- **Legacy pattern.** Legacy body.\n"
            "- Rule: **Rationale-backed pattern.** New body.\n"
            "  Because: It reads as a model tell."
        )})(),
    )
    assert parsed_patterns() == [
        {"title": "Legacy pattern", "body": "Legacy body."},
        {"title": "Rationale-backed pattern", "body": "New body."},
    ]
