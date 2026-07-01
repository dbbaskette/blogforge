from uuid import uuid4

from blogforge.drafts.models import Draft, IdeaInput, Section
from blogforge.generate.geo import (
    build_report,
    parse_faq,
    parse_semantic,
    score_structural,
)


def _draft(sections: list[Section], title: str = "My Post") -> Draft:
    idea = IdeaInput(topic=title, pack_slug="", provider="tanzu", model="m")
    return Draft(title=title, idea=idea, sections=sections, stage="sections")


def _sec(title: str, content: str) -> Section:
    return Section(
        id=uuid4().hex,
        title=title,
        content_md=content,
        status="edited",
        word_count=len(content.split()),
    )


def test_question_headings_scored_and_flagged() -> None:
    d = _draft([_sec("How do I start?", "Do X."), _sec("Setup", "Then Y.")])
    levers = score_structural(d)
    qh = levers["question_headings"]
    # 1 of 2 headings is a question.
    assert "1 of 2" in qh["detail"]
    # The non-question heading is offered a fix.
    assert qh["fix"] == "question_heading"
    assert any("Setup" in f["note"] for f in qh["findings"])


def test_skimmability_penalizes_no_lists() -> None:
    d = _draft([_sec("Intro", "Plain prose with no lists at all.")])
    assert score_structural(d)["skimmability"]["score"] == 40
    d2 = _draft([_sec("Intro", "- one\n- two\n- three")])
    assert score_structural(d2)["skimmability"]["score"] >= 90


def test_faq_presence_detected() -> None:
    absent = score_structural(_draft([_sec("Intro", "hi")]))["faq"]
    assert absent["fix"] == "faq" and absent["score"] == 30
    present = score_structural(_draft([_sec("FAQ", "Q&A")]))["faq"]
    assert present["fix"] is None and present["score"] == 100


def test_chunking_flags_backreferences() -> None:
    d = _draft([_sec("Intro", "As mentioned above, this matters.")])
    chunk = score_structural(d)["chunking"]
    assert chunk["score"] < 100
    assert any("above" in f["note"] for f in chunk["findings"])


def test_parse_semantic_maps_weak_sections_to_ids() -> None:
    intro = _sec("Intro", "x")
    d = _draft([intro])
    raw = (
        '{"answer_first": {"score": 55, "note": "buries answers", "weak_sections": ["Intro"]},'
        '"definitional_opener": {"score": 40, "note": "no opener"},'
        '"factual_density": {"score": 30, "note": "vague", "thin_spots": ['
        '{"target": "It is fast.", "note": "add a benchmark"}]}}'
    )
    levers = parse_semantic(raw, d)
    assert levers["answer_first"]["fix"] == "answer_first"
    assert levers["answer_first"]["findings"][0]["section_id"] == intro.id
    # Low definitional score offers the fix.
    assert levers["definitional_opener"]["fix"] == "definitional"
    # Factual density is flag-only — never a fix.
    assert levers["factual_density"]["fix"] is None
    assert levers["factual_density"]["findings"][0]["target"] == "It is fast."


def test_parse_semantic_tolerates_junk() -> None:
    d = _draft([_sec("Intro", "x")])
    levers = parse_semantic("not json", d)
    assert levers["answer_first"]["score"] == 0
    assert levers["factual_density"]["findings"] == []


def test_build_report_weights_and_grades() -> None:
    # All levers at 100 → score 100 → grade A.
    perfect = {k: {"key": k, "label": k, "score": 100, "detail": "", "findings": [], "fix": None}
               for k in ("answer_first", "factual_density", "definitional_opener",
                         "question_headings", "skimmability", "faq", "chunking")}
    report = build_report(perfect)
    assert report["score"] == 100
    assert report["grade"] == "A"
    assert len(report["levers"]) == 7
    # answer_first is displayed first.
    assert report["levers"][0]["key"] == "answer_first"


def test_parse_faq() -> None:
    raw = '{"faqs": [{"q": "What is it?", "a": "A tool."}, {"q": "", "a": "x"}, {"q": "Why?", "a": ""}]}'
    assert parse_faq(raw, 4) == [{"q": "What is it?", "a": "A tool."}]
    assert parse_faq("junk", 4) == []
