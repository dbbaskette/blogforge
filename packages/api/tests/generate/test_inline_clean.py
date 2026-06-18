"""_clean_inline_output — strip self-correction narration from inline AI fixes."""
from blogforge.generate.inline import _clean_inline_output


def test_strips_self_correction_and_keeps_final_version() -> None:
    raw = (
        "Spring Boot dependencies — the libraries underneath the framework — "
        "rotate new versions every couple of months on their own schedules. "
        "Wait, I need to fix the em dashes. "
        "Spring Boot dependencies (the libraries underneath the framework) "
        "rotate new versions every couple of months on their own schedules."
    )
    assert _clean_inline_output(raw) == (
        "Spring Boot dependencies (the libraries underneath the framework) "
        "rotate new versions every couple of months on their own schedules."
    )


def test_leaves_clean_output_untouched() -> None:
    s = "The release cadence is unpredictable, so pin your versions."
    assert _clean_inline_output(s) == s


def test_strips_surrounding_quotes() -> None:
    assert _clean_inline_output('"A tidy rewrite."') == "A tidy rewrite."


def test_meta_marker_as_only_sentence_is_kept() -> None:
    # A legit short sentence that merely contains a marker word, with nothing
    # after it, must not be dropped (no "final version" follows).
    s = "Let me know what you think."
    assert _clean_inline_output(s) == s
