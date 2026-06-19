from blogforge.voice.lint import detect_ai_patterns

def test_vague_attribution_detected() -> None:
    hits = detect_ai_patterns("Experts say this is best. Studies show it works. Industry reports suggest growth.")
    assert any(h.rule_id == "ai_pattern:vague_attribution" for h in hits)

def test_named_action_not_flagged_as_vague() -> None:
    hits = detect_ai_patterns("The team shipped the feature on Tuesday and measured a 30% gain.")
    assert all("vague_attribution" not in h.rule_id for h in hits)
