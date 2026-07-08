from blogforge.voice.lint import detect_ai_patterns

def test_vague_attribution_detected() -> None:
    hits = detect_ai_patterns("Experts say this is best. Studies show it works. Industry reports suggest growth.")
    assert any(h.rule_id == "ai_pattern:vague_attribution" for h in hits)

def test_named_action_not_flagged_as_vague() -> None:
    hits = detect_ai_patterns("The team shipped the feature on Tuesday and measured a 30% gain.")
    assert all("vague_attribution" not in h.rule_id for h in hits)

def test_staccato_pairs_run_flagged():
    text = (
        "The platform handles this well. Isolation and security. Cost and control. "
        "As well as speed and scale. The rest of the post explains how."
    )
    hits = detect_ai_patterns(text)
    ids = [h.rule_id for h in hits]
    assert "ai_pattern:staccato_pairs" in ids


def test_single_pair_sentence_not_flagged():
    text = "We measured cost and control. Then we moved on to the deployment story in detail."
    hits = detect_ai_patterns(text)
    assert all(h.rule_id != "ai_pattern:staccato_pairs" for h in hits)


def test_long_sentences_with_and_not_flagged():
    text = (
        "The platform gives you the deployment surface and the credential story you already "
        "trust. It also gives you the network policy and the audit trail your team asked for."
    )
    hits = detect_ai_patterns(text)
    assert all(h.rule_id != "ai_pattern:staccato_pairs" for h in hits)


def test_as_well_as_sentence_start_flagged():
    text = "You get sandboxes. As well as full logging for every call."
    hits = detect_ai_patterns(text)
    assert any(h.rule_id == "ai_pattern:staccato_pairs" for h in hits)


def test_short_narrative_and_clauses_not_flagged():
    text = "We shipped it and moved on. We tested it and shipped again."
    hits = detect_ai_patterns(text)
    assert all(h.rule_id != "ai_pattern:staccato_pairs" for h in hits)


def test_staccato_run_offsets_bracket_the_run():
    text = (
        "The platform handles this well. Isolation and security. Cost and control. "
        "As well as speed and scale. The rest of the post explains how."
    )
    hits = detect_ai_patterns(text)
    run_hits = [
        h for h in hits
        if h.rule_id == "ai_pattern:staccato_pairs"
        and h.message.startswith("Staccato paired-list run")
    ]
    assert len(run_hits) == 1
    expected_start = text.index("Isolation and security.")
    expected_end = text.index("Cost and control.") + len("Cost and control.")
    assert (run_hits[0].start, run_hits[0].end) == (expected_start, expected_end)


def test_curly_apostrophe_pairs_run_flagged():
    text = "It’s fast and it’s cheap. It’s slow and it’s dear."
    hits = detect_ai_patterns(text)
    assert any(h.rule_id == "ai_pattern:staccato_pairs" for h in hits)
