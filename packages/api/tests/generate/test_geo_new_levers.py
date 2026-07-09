"""Deterministic checks for the 2026 lever additions."""
from uuid import uuid4

from blogforge.drafts.models import Draft, IdeaInput, Section
from blogforge.generate.geo import score_structural


def make_draft(*, title: str = "My Post", first_para: str = "", body: str = "") -> Draft:
    """Minimal single-section Draft fixture (test_geo.py has no importable
    make_draft helper — its _draft/_sec pattern copied here per the brief)."""
    content = "\n\n".join(p for p in (first_para, body) if p)
    idea = IdeaInput(topic=title, pack_slug="", provider="tanzu", model="m")
    section = Section(
        id=uuid4().hex,
        title="Body",
        content_md=content,
        status="edited",
        word_count=len(content.split()),
    )
    return Draft(title=title, idea=idea, sections=[section], stage="sections")


def test_answer_capsule_detects_capsule() -> None:
    # ~50-word link-free opening paragraph mentioning the title entity.
    opener = ("BlogForge is a drafting tool that writes long-form posts in your own "
              "voice. It researches a topic, plans one coherent outline, composes the "
              "whole draft in a single pass, and then strips the telltale phrases that "
              "make text read as machine-written, before you edit.")
    d = make_draft(title="BlogForge review", first_para=opener)
    res = score_structural(d)
    assert res["answer_capsule"]["score"] >= 80


def test_answer_capsule_flags_missing_capsule() -> None:
    d = make_draft(title="BlogForge review", first_para="Short.")
    res = score_structural(d)
    assert res["answer_capsule"]["score"] <= 50
    assert res["answer_capsule"]["findings"]


def test_definitive_language_penalizes_hedges() -> None:
    hedgy = ("It might be possible that this could perhaps work. Some believe it "
             "may help. It seems the results could arguably vary somewhat.")
    d = make_draft(body=hedgy)
    res = score_structural(d)
    assert res["definitive_language"]["score"] <= 40
    assert res["definitive_language"]["findings"]


def test_definitive_language_ignores_dated_attribution_month_may() -> None:
    # "May" the month (capitalized, in a dated attribution) is exactly the
    # GOOD form the freshness/stat_attribution levers reward — it must NOT be
    # mistaken for the hedge word "may". A genuinely hedged paragraph should
    # still score low right alongside it.
    dated = (
        "Costs fell 31% as of May 2026, per Ahrefs. In May, we shipped the fix "
        "and adoption grew 12% by June 2026, per our own dashboard."
    )
    d = make_draft(body=dated)
    res = score_structural(d)["definitive_language"]
    assert res["score"] >= 80
    assert not res["findings"]

    hedgy = ("It might be possible that this could perhaps work. Some believe it "
             "may help. It seems the results could arguably vary somewhat.")
    d2 = make_draft(body=hedgy)
    res2 = score_structural(d2)["definitive_language"]
    assert res2["score"] <= 40
    assert res2["findings"]


def test_page_front_load_rewards_facts_up_top() -> None:
    front = "We measured 42ms p95. Costs fell 31% in 2026. " * 3
    back = "This is narrative filler with no numbers at all. " * 20
    d = make_draft(body=front + back)
    assert score_structural(d)["page_front_load"]["score"] >= 70
