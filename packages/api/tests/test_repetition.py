"""Repetition analyzer catches the cross-section recycling that the
per-rule style linter can't see — modeled on a real draft where the intro
was pasted into section one and "paved road" / "Avengers-level threat"
recurred across sections."""
from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, Section
from blogforge.drafts.repetition import analyze_repetition


def _idea() -> IdeaInput:
    return IdeaInput(topic="local-first", pack_slug="dan", provider="anthropic", model="m")


def _rules(findings: list[dict[str, object]]) -> set[str]:
    return {str(f["rule"]) for f in findings}


def test_flags_intro_paragraph_duplicated_into_first_section():
    hook = (
        "We used to trust our gadgets, until HiDock quietly shipped our recordings "
        "off to a server we never agreed to. That betrayal is where local-first begins."
    )
    draft = Draft(
        idea=_idea(),
        outline=OutlineProposal(opening_hook=hook),
        sections=[
            Section(id="s1", title="The Betrayal", content_md=hook + "\n\nSo here is the plan."),
            Section(id="s2", title="The Concept", content_md="Local-first keeps data on your box."),
        ],
    )
    findings = analyze_repetition(draft)
    assert "duplicate-paragraph" in _rules(findings)


def test_flags_phrase_recycled_across_sections():
    draft = Draft(
        idea=_idea(),
        sections=[
            Section(
                id="s1",
                title="One",
                content_md="This is an Avengers-level threat to your privacy and autonomy.",
            ),
            Section(
                id="s2",
                title="Two",
                content_md="Make no mistake, it remains an Avengers-level threat even today.",
            ),
            Section(
                id="s3",
                title="Three",
                content_md="The cloud gave us a paved road; the paved road had a toll.",
            ),
            Section(
                id="s4",
                title="Four",
                content_md="We left the paved road behind for something we actually own.",
            ),
        ],
    )
    findings = analyze_repetition(draft)
    assert "repeated-phrase" in _rules(findings)
    phrases = " ".join(str(f["text"]) for f in findings)
    assert "avengers-level threat" in phrases
    assert "paved road" in phrases


def test_flags_echoed_section_openers():
    draft = Draft(
        idea=_idea(),
        sections=[
            Section(
                id="s1",
                title="One",
                content_md="For years we accepted the trade-off without a second thought.",
            ),
            Section(
                id="s2",
                title="Two",
                content_md="For years we accepted the trade-off because it felt inevitable.",
            ),
        ],
    )
    findings = analyze_repetition(draft)
    assert "echoed-opener" in _rules(findings)


def test_clean_draft_has_no_findings():
    draft = Draft(
        idea=_idea(),
        outline=OutlineProposal(opening_hook="A gadget broke our trust, and that is the story."),
        sections=[
            Section(
                id="s1",
                title="Problem",
                content_md="Vendors quietly route private recordings through servers nobody vetted.",
            ),
            Section(
                id="s2",
                title="Mechanism",
                content_md="A small daemon indexes files on disk so nothing ever leaves the laptop.",
            ),
            Section(
                id="s3",
                title="Payoff",
                content_md="You keep ownership, latency drops, and the subscription bill disappears.",
            ),
        ],
    )
    assert analyze_repetition(draft) == []


def test_single_section_is_a_noop():
    draft = Draft(idea=_idea(), sections=[Section(id="s1", title="Only", content_md="One bit.")])
    assert analyze_repetition(draft) == []
