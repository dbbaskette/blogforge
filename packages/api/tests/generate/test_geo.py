from uuid import uuid4

from blogforge.drafts.models import Draft, IdeaInput, Section
from blogforge.generate.geo import (
    augment_definitional,
    augment_factual_density,
    build_report,
    clean_opener,
    clean_table,
    detect_duplicate_opening,
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


def test_skimmability_wall_finding_targets_the_dense_paragraph() -> None:
    dense = "x" * 800
    d = _draft([_sec("Intro", f"Short lead.\n\n{dense}\n\nShort tail.")])
    findings = score_structural(d)["skimmability"]["findings"]
    assert len(findings) == 1
    # The finding pinpoints the ONE dense paragraph, so the fix can splice
    # just that block instead of rewriting the whole section.
    assert findings[0]["target"] == dense
    assert findings[0]["fix"] == "bullets"


def test_faq_presence_detected() -> None:
    absent = score_structural(_draft([_sec("Intro", "hi")]))["faq"]
    assert absent["fix"] == "faq" and absent["score"] == 30
    present = score_structural(_draft([_sec("FAQ", "Q&A")]))["faq"]
    assert present["fix"] is None and present["score"] == 100


def test_faq_detected_inside_section_content() -> None:
    # The GEO fix appends "### FAQ" INTO the last section instead of adding a
    # new section card — the detector must still see it.
    d = _draft([_sec("Intro", "Body text.\n\n### FAQ\n\n**What is it?**\n\nA thing.")])
    present = score_structural(d)["faq"]
    assert present["score"] == 100 and present["fix"] is None


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
        '"definitional_opener": {"score": 40, "note": "no opener", "has_definition": false},'
        '"factual_density": {"score": 30, "note": "vague", "thin_spots": ['
        '{"target": "It is fast.", "note": "add a benchmark"}]}}'
    )
    levers = parse_semantic(raw, d)
    assert levers["answer_first"]["fix"] == "answer_first"
    assert levers["answer_first"]["findings"][0]["section_id"] == intro.id
    # Low score AND no existing definition → offer to add one.
    assert levers["definitional_opener"]["fix"] == "definitional"
    # Factual density is flag-only — never a fix.
    assert levers["factual_density"]["fix"] is None
    assert levers["factual_density"]["findings"][0]["target"] == "It is fast."


def test_low_definitional_score_with_existing_definition_offers_improve() -> None:
    """The 40/45-score live case: a definition EXISTS but is buried. We don't
    ADD (that made duplicates) — we offer to IMPROVE (hoist it up), so the
    writer isn't stuck with the score."""
    d = _draft([_sec("Intro", "x")])
    raw = (
        '{"answer_first": {"score": 80, "note": "ok"},'
        '"definitional_opener": {"score": 40, "note": "buried in narrative", '
        '"has_definition": true},'
        '"factual_density": {"score": 80, "note": "ok"}}'
    )
    assert parse_semantic(raw, d)["definitional_opener"]["fix"] == "definitional_improve"
    # No definition at all → offer to ADD one.
    raw_none = raw.replace('"has_definition": true', '"has_definition": false')
    assert parse_semantic(raw_none, d)["definitional_opener"]["fix"] == "definitional"


def test_answer_first_matches_emphasis_wrapped_titles() -> None:
    """Stored titles keep their markdown (** for export), but the model returns
    clean titles — matching must ignore emphasis so the fix resolves a section."""
    rotate = _sec("**ROTATE: identity**", "buried answer")
    d = _draft([rotate])
    raw = (
        '{"answer_first": {"score": 30, "note": "buries", "weak_sections": ["ROTATE: identity"]},'
        '"definitional_opener": {"score": 90, "note": "ok", "has_definition": true},'
        '"factual_density": {"score": 90, "note": "ok"}}'
    )
    af = parse_semantic(raw, d)["answer_first"]
    assert af["findings"][0]["section_id"] == rotate.id
    assert af["findings"][0]["fix"] == "answer_first"
    # The displayed note is clean (no ** shown).
    assert af["findings"][0]["note"].startswith('"ROTATE: identity"')


def test_parse_semantic_tolerates_junk() -> None:
    d = _draft([_sec("Intro", "x")])
    levers = parse_semantic("not json", d)
    assert levers["answer_first"]["score"] == 0
    assert levers["factual_density"]["findings"] == []


def test_build_report_weights_and_grades() -> None:
    # All levers at 100 → score 100 → grade A.
    perfect = {
        k: {"key": k, "label": k, "score": 100, "detail": "", "findings": [], "fix": None}
        for k in (
            "answer_first",
            "factual_density",
            "definitional_opener",
            "brand_explicit",
            "question_headings",
            "skimmability",
            "comparison_table",
            "faq",
            "chunking",
        )
    }
    report = build_report(perfect)
    assert report["score"] == 100
    assert report["grade"] == "A"
    assert len(report["levers"]) == 9
    # answer_first is displayed first.
    assert report["levers"][0]["key"] == "answer_first"


def test_parse_semantic_carries_thin_spot_suggestion() -> None:
    d = _draft([_sec("Intro", "x")])
    raw = (
        '{"answer_first": {"score": 80, "note": "ok"},'
        '"definitional_opener": {"score": 90, "note": "ok"},'
        '"factual_density": {"score": 40, "note": "vague", "thin_spots": ['
        '{"target": "Teams love it.", "note": "unsupported", '
        '"suggestion": "Add your NPS score or a named customer quote."}]}}'
    )
    fd = parse_semantic(raw, d)["factual_density"]
    assert fd["findings"][0]["suggestion"] == "Add your NPS score or a named customer quote."


def test_clean_opener_strips_noise() -> None:
    assert clean_opener('"BlogForge is a drafting tool that keeps your voice."\n\nExtra.') == (
        "BlogForge is a drafting tool that keeps your voice."
    )
    assert clean_opener("## Heading style") == "Heading style"
    assert clean_opener("   \n") == ""


OPENER_SENT = "BlogForge is a drafting tool that keeps your voice."


def test_detect_duplicate_opening_back_to_back() -> None:
    content = f"{OPENER_SENT}\n\n{OPENER_SENT}\n\nThen the real body starts."
    block = detect_duplicate_opening(content)
    assert block is not None
    assert block.count("BlogForge is a drafting tool") == 2
    assert "real body" not in block


def test_detect_duplicate_opening_tolerates_quote_glyphs() -> None:
    # First copy straight-quoted, second curly-quoted — still a duplicate.
    content = f'"{OPENER_SENT}" “{OPENER_SENT}” More text follows here.'
    assert detect_duplicate_opening(content) is not None


def test_detect_duplicate_opening_clean_content() -> None:
    assert detect_duplicate_opening("One sentence. A different second sentence.") is None
    assert detect_duplicate_opening("Only one sentence here.") is None
    assert detect_duplicate_opening("") is None


def test_augment_definitional_injects_dedupe_finding_and_caps_score() -> None:
    first = _sec("Intro", f"{OPENER_SENT} {OPENER_SENT} Then more.")
    d = _draft([first])
    levers = {
        "definitional_opener": {
            "key": "definitional_opener",
            "label": "Definitional opener",
            "score": 90,
            "detail": "",
            "findings": [],
            "fix": None,
        }
    }
    augment_definitional(levers, d)
    lever = levers["definitional_opener"]
    assert lever["score"] == 45
    assert lever["findings"][0]["fix"] == "dedupe_opening"
    assert lever["findings"][0]["section_id"] == first.id
    assert OPENER_SENT in lever["findings"][0]["target"]


def test_augment_definitional_noop_when_clean() -> None:
    d = _draft([_sec("Intro", "A clean opening. Followed by different prose.")])
    levers = {
        "definitional_opener": {
            "key": "definitional_opener",
            "label": "Definitional opener",
            "score": 90,
            "detail": "",
            "findings": [],
            "fix": None,
        }
    }
    augment_definitional(levers, d)
    assert levers["definitional_opener"]["score"] == 90
    assert levers["definitional_opener"]["findings"] == []


def test_comparison_table_flags_prose_comparison() -> None:
    body = (
        "Option A is cheaper than Option B, but Option B is faster. "
        "Compared to Option C, both scale better under load."
    )
    d = _draft([_sec("Pricing tiers", body)])
    lever = score_structural(d)["comparison_table"]
    assert lever["fix"] == "comparison_table"
    assert lever["score"] < 100
    assert lever["findings"][0]["section_id"] == d.sections[0].id


def test_comparison_table_passes_when_a_table_is_present() -> None:
    body = (
        "Here's the breakdown:\n\n"
        "| Option | Cost |\n| --- | --- |\n| A | $1 |\n| B | $2 |\n\n"
        "Compared to the alternatives, A wins on price."
    )
    lever = score_structural(_draft([_sec("Pricing", body)]))["comparison_table"]
    assert lever["score"] == 100 and lever["fix"] is None


def test_comparison_table_neutral_without_comparison_content() -> None:
    d = _draft([_sec("Intro", "A plain paragraph about one idea, no options at all.")])
    lever = score_structural(d)["comparison_table"]
    assert lever["score"] == 100 and lever["fix"] is None and lever["findings"] == []


def test_clean_table_keeps_only_the_table() -> None:
    raw = "Sure! Here's the table:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nHope that helps."
    assert clean_table(raw) == "| A | B |\n| --- | --- |\n| 1 | 2 |"
    assert clean_table("no table here, just prose.") == ""


def test_brand_explicit_lever_parsed() -> None:
    d = _draft([_sec("Intro", "x")])
    raw = (
        '{"answer_first": {"score": 80, "note": "ok"},'
        '"definitional_opener": {"score": 90, "note": "ok", "has_definition": true},'
        '"factual_density": {"score": 80, "note": "ok"},'
        '"brand_explicit": {"score": 40, "note": "brand only implied", '
        '"brand": "Tanzu", "stated_up_top": false}}'
    )
    lever = parse_semantic(raw, d)["brand_explicit"]
    assert lever["key"] == "brand_explicit"
    assert lever["score"] == 40
    assert "implied" in lever["detail"]


def test_augment_factual_density_flags_fluff_and_caps_score() -> None:
    fluff = "Our seamless, world-class, cutting-edge platform lets you leverage synergy."
    d = _draft([_sec("Intro", fluff)])
    levers = {
        "factual_density": {
            "key": "factual_density",
            "label": "Factual density",
            "score": 90,
            "detail": "",
            "findings": [],
            "fix": None,
        }
    }
    augment_factual_density(levers, d)
    lever = levers["factual_density"]
    assert lever["score"] <= 70
    assert "leverage synergy" in lever["findings"][0]["target"]


def test_augment_factual_density_noop_when_grounded() -> None:
    # Concrete numbers present → not fluff, even with one buzzword.
    d = _draft([_sec("Intro", "We cut p95 latency 42% and rotate 3,000 secrets a day.")])
    levers = {
        "factual_density": {
            "key": "factual_density",
            "label": "Factual density",
            "score": 88,
            "detail": "",
            "findings": [],
            "fix": None,
        }
    }
    augment_factual_density(levers, d)
    assert levers["factual_density"]["score"] == 88
    assert levers["factual_density"]["findings"] == []


def test_draft_text_leads_with_the_opening_hook() -> None:
    """The intro (opening_hook) must lead the text the model scores, ABOVE the
    first section — else definitional-opener/answer-first judge section 1, not
    the real intro (the reported bug)."""
    from blogforge.drafts.models import OutlineProposal
    from blogforge.generate.geo import _draft_text

    d = _draft([_sec("ROTATE", "The 2017 baseline.")])
    d.outline = OutlineProposal(opening_hook="In January 2017, the team wrote a post.")
    text = _draft_text(d)
    assert "In January 2017" in text
    assert text.index("In January 2017") < text.index("## ROTATE")


def test_parse_faq() -> None:
    raw = (
        '{"faqs": [{"q": "What is it?", "a": "A tool."}, '
        '{"q": "", "a": "x"}, {"q": "Why?", "a": ""}]}'
    )
    assert parse_faq(raw, 4) == [{"q": "What is it?", "a": "A tool."}]
    assert parse_faq("junk", 4) == []


def test_lever_carries_its_weight_for_client_rescore() -> None:
    # Each scored lever exposes its weight so a targeted re-score can recompute
    # the overall total on the client without re-running everything.
    sk = score_structural(_draft([_sec("Intro", "hi")]))["skimmability"]
    assert sk["weight"] > 0


class _NoLLM:
    name = "no"

    async def complete(self, **_kw):  # type: ignore[no-untyped-def]
        raise AssertionError("structural-only rescore must not call the LLM")


class _JsonLLM:
    name = "json"

    def __init__(self, text: str) -> None:
        self._text = text

    async def complete(self, **_kw):  # type: ignore[no-untyped-def]
        from blogforge.llm.base import LLMResponse

        return LLMResponse(
            text=self._text, input_tokens=1, output_tokens=1, model="m", finish_reason="stop"
        )


def _fake_pack(tmp_path):  # type: ignore[no-untyped-def]
    root = tmp_path / "pack"
    root.mkdir()
    (root / "stylepack.yaml").write_text(
        "spec_version: '1.0'\npack:\n  slug: dan\n  name: Dan\n  version: '1.0'\n  author: Dan\n"
        "persona:\n  identity: x\n  one_line: y\n"
    )
    (root / "style-guide.md").write_text("Be brief.\n")
    return root


async def test_rescore_structural_only_skips_the_llm(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from blogforge.generate.geo import rescore_geo

    d = _draft([_sec("Intro", "Plain prose with no lists at all.")])
    out = await rescore_geo(d, ["skimmability"], tmp_path, _NoLLM(), model="m")
    # Only the requested lever comes back, computed with no LLM call.
    assert set(out) == {"skimmability"}
    assert out["skimmability"]["key"] == "skimmability"


async def test_rescore_returns_only_the_requested_semantic_lever(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from blogforge.generate.geo import rescore_geo

    raw = (
        '{"answer_first": {"score": 55, "note": "ok"},'
        '"definitional_opener": {"score": 90, "note": "ok", "has_definition": true},'
        '"factual_density": {"score": 70, "note": "ok"},'
        '"brand_explicit": {"score": 40, "note": "implied"}}'
    )
    d = _draft([_sec("Intro", "x")])
    out = await rescore_geo(d, ["answer_first"], _fake_pack(tmp_path), _JsonLLM(raw), model="m")
    assert set(out) == {"answer_first"}
    assert out["answer_first"]["score"] == 55
