from blogforge.generate.sanitize import strip_scaffolding


def test_strips_single_line_bracket_block() -> None:
    md = "Real prose. ⟦REMINDER: fix later⟧ More prose."
    out = strip_scaffolding(md)
    assert "REMINDER" not in out
    assert "Real prose." in out and "More prose." in out


def test_strips_multiline_paired_block_including_held_content() -> None:
    md = (
        "Intro paragraph.\n\n"
        "**⟦PARKED MATERIAL - find a home⟧**\n\n"
        "Held text across\nmultiple lines.\n\n"
        "**⟦end PARKED MATERIAL⟧**\n\n"
        "Closing paragraph."
    )
    out = strip_scaffolding(md)
    # An open...end marker pair removes the WHOLE block, held content included.
    assert "PARKED MATERIAL" not in out
    assert "Held text" not in out
    assert "**" not in out
    assert "Intro paragraph." in out
    assert "Closing paragraph." in out


def test_strips_lone_marker_with_no_end() -> None:
    md = "Keep this. ⟦TODO: revisit⟧ Keep that."
    out = strip_scaffolding(md)
    assert "TODO" not in out
    assert "Keep this." in out and "Keep that." in out


def test_strips_html_comments() -> None:
    md = "Before. <!-- editor note: cut this --> After."
    out = strip_scaffolding(md)
    assert "editor note" not in out
    assert "Before." in out and "After." in out


def test_collapses_blank_runs_left_by_removal() -> None:
    md = "A.\n\n⟦drop⟧\n\n\n⟦drop2⟧\n\nB."
    out = strip_scaffolding(md)
    assert "\n\n\n" not in out
    assert out.startswith("A.") and out.rstrip().endswith("B.")


def test_leaves_clean_prose_untouched() -> None:
    md = "# Title\n\nA normal paragraph with **bold** and a [link](https://x.com)."
    assert strip_scaffolding(md) == md
