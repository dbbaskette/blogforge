"""Built-in output formats registry + directive resolution."""
from __future__ import annotations

from blogforge.generate.builtin_formats import (
    BUILTIN_FORMATS,
    builtin_format_directive,
    builtin_format_section_note,
    list_builtin_formats,
)

_EXPECTED_SLUGS = {
    "product-release",
    "how-to",
    "deep-dive",
    "comparison",
    "announcement",
    "listicle",
}


def test_registry_ships_the_six_approved_formats() -> None:
    slugs = {f["slug"] for f in BUILTIN_FORMATS}
    assert slugs == _EXPECTED_SLUGS


def test_list_builtin_formats_uses_slug_as_name_and_labelled_description() -> None:
    listed = list_builtin_formats()
    assert len(listed) == len(_EXPECTED_SLUGS)
    by_name = {f["name"]: f for f in listed}
    assert set(by_name) == _EXPECTED_SLUGS
    # description carries the human label so the picker renders "<slug> — <label>"
    assert by_name["product-release"]["description"].startswith("Product release / launch")


def test_directive_resolves_by_slug() -> None:
    directive = builtin_format_directive("product-release")
    assert directive is not None
    assert "PRODUCT RELEASE" in directive


def test_directive_resolves_by_label_case_insensitively() -> None:
    assert builtin_format_directive("How-To / Tutorial") == builtin_format_directive("how-to")


def test_directive_none_for_unknown_or_empty() -> None:
    assert builtin_format_directive(None) is None
    assert builtin_format_directive("") is None
    assert builtin_format_directive("not-a-format") is None


def test_section_note_wraps_directive_as_context() -> None:
    note = builtin_format_section_note("how-to")
    assert note is not None
    # Frames the format as context and forbids reproducing the whole skeleton.
    assert "do not reproduce the whole structure" in note
    # Still carries the underlying directive so section conventions apply.
    assert "HOW-TO" in note


def test_section_note_none_for_non_builtin() -> None:
    assert builtin_format_section_note(None) is None
    assert builtin_format_section_note("not-a-format") is None
