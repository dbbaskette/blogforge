"""Section-anchoring helpers for the interactive lint endpoint."""
from types import SimpleNamespace

from blogforge.api.lint import (
    _anchor_hit,
    _anchor_repetition,
    _slice_utf16,
    _utf16_offset,
)


def test_utf16_offset_and_slice_roundtrip_bmp() -> None:
    text = "the quick brown fox"
    start = _utf16_offset(text, 4)  # "quick"
    end = _utf16_offset(text, 9)
    assert (start, end) == (4, 9)
    assert _slice_utf16(text, start, end) == "quick"


def test_utf16_offset_handles_astral_chars() -> None:
    text = "a 😀 z"  # emoji is 2 UTF-16 code units
    # char index 3 is the space after the emoji → utf-16 offset 4 (1 + 1 + 2)
    assert _utf16_offset(text, 3) == 4
    # slicing the emoji back out via utf-16 offsets is exact
    assert _slice_utf16(text, 2, 4) == "😀"


def test_anchor_hit_shape() -> None:
    hit = SimpleNamespace(start=4, end=9, rule_id="banished_word:quick", message="Avoid 'quick'.")
    out = _anchor_hit(hit, "violation", "sec-1", "the quick brown fox")
    assert out["kind"] == "violation"
    assert out["section_id"] == "sec-1"
    assert out["start"] == 4 and out["end"] == 9
    assert out["match"] == "quick"  # sliced from the body via offsets
    assert out["rule"] == "banished_word:quick"
    assert out["id"] == "violation:sec-1:4:banished_word:quick"


def test_anchor_repetition_resolves_section_and_offsets() -> None:
    sections = [
        SimpleNamespace(id="a", content_md="An unrelated opening paragraph."),
        SimpleNamespace(id="b", content_md="We deliver a paved road for developers."),
    ]
    finding = {"rule": "repeated-phrase", "message": "appears 2x", "text": "paved road…"}
    out = _anchor_repetition(finding, sections)
    assert out["section_id"] == "b"
    assert out["match"] == "paved road"
    # offsets point at "paved road" inside section b
    assert _slice_utf16(sections[1].content_md, out["start"], out["end"]) == "paved road"


def test_anchor_repetition_unlocated_phrase_is_listed_without_anchor() -> None:
    sections = [SimpleNamespace(id="a", content_md="nothing matching here")]
    finding = {"rule": "echoed-opener", "message": "echo", "text": "for years we traded…"}
    out = _anchor_repetition(finding, sections)
    assert out["section_id"] is None
    assert out["start"] is None and out["end"] is None
    assert out["match"] == "for years we traded"
