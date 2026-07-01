from blogforge.generate.ingest import ingest_document


def test_ingest_preserves_original_heading_markdown() -> None:
    """Emphasis in headings is kept in the stored doc so exports stay faithful;
    stripping is a display-only concern (frontend + GEO matching)."""
    md = "# **Faster is Still Safer**\n\n## **ROTATE: identity**\n\nBody with **bold** kept."
    result = ingest_document(md)
    assert result.title == "**Faster is Still Safer**"
    assert result.sections[0].title == "**ROTATE: identity**"
    assert "**bold**" in result.sections[0].content_md


def test_h1_title_and_h2_sections() -> None:
    md = (
        "# My Great Post\n\n"
        "## Intro\n\nHello there.\n\n"
        "## Body\n\nThe meat of it.\n\n"
        "## Conclusion\n\nWrap up."
    )
    result = ingest_document(md)
    assert result.title == "My Great Post"
    assert [s.title for s in result.sections] == ["Intro", "Body", "Conclusion"]
    assert result.sections[0].content_md == "Hello there."
    assert result.sections[1].content_md == "The meat of it."
    # H1 line must not leak into any section body.
    assert all("# My Great Post" not in s.content_md for s in result.sections)
    # Imported sections are marked "edited" so the editor treats them as real.
    assert all(s.status == "edited" for s in result.sections)
    assert all(s.id for s in result.sections)
    assert result.sections[0].word_count == 2


def test_lead_text_before_first_heading_becomes_the_opening() -> None:
    """A lede written above the first ## is the article's opening. It must NOT be
    folded under the first section's heading — that would move it BELOW that
    heading on export (import→export wouldn't round-trip) and read as if the
    opening were cut. It's returned separately as the opening instead."""
    md = "# Title\n\nA punchy opening line.\n\n## First\n\nBody one."
    result = ingest_document(md)
    assert result.opening == "A punchy opening line."
    assert [s.title for s in result.sections] == ["First"]
    # The first section holds only its own body — the opening isn't duplicated in.
    assert result.sections[0].content_md == "Body one."
    assert "A punchy opening line." not in result.sections[0].content_md


def test_no_lead_before_first_heading_has_empty_opening() -> None:
    # H1 immediately followed by H2 (no lede) → no separate opening.
    md = "# My Great Post\n\n## Intro\n\nHello there.\n\n## Body\n\nThe meat."
    result = ingest_document(md)
    assert result.opening == ""
    assert result.sections[0].content_md == "Hello there."


def test_no_headings_becomes_one_section() -> None:
    md = "Just a plain paragraph.\n\nAnd another one, no headings anywhere."
    result = ingest_document(md)
    assert result.title == "Just a plain paragraph."
    assert len(result.sections) == 1
    assert result.sections[0].content_md == md.strip()


def test_h2_only_derives_title_from_first_heading_text() -> None:
    md = "## Getting started\n\nStep one.\n\n## Next\n\nStep two."
    result = ingest_document(md)
    assert result.title == "Getting started"
    assert [s.title for s in result.sections] == ["Getting started", "Next"]


def test_empty_input_yields_no_sections() -> None:
    result = ingest_document("   \n  \n")
    assert result.title == "Imported draft"
    assert result.sections == []


def test_overlong_first_line_title_is_clamped() -> None:
    long_line = "x" * 200
    result = ingest_document(long_line)
    assert len(result.title) <= 120
    assert result.title.endswith("…")
