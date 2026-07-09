"""Pin the 2026 research refresh of the universal AI-tell assets."""
from blogforge.voice.ai_tells import load_ai_tells


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
