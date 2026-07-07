from pathlib import Path

from blogforge.generate import humanize


def test_load_rubric_bundled_has_all_lenses():
    text = humanize.load_rubric(None)
    for lens in ("flow", "voice", "imperfections", "soul"):
        assert f"## {lens}" in text


def test_load_rubric_pack_override(tmp_path: Path):
    override = tmp_path / "humanize" / "lenses.md"
    override.parent.mkdir(parents=True)
    override.write_text("## flow — custom\noverride body\n", encoding="utf-8")
    text = humanize.load_rubric(tmp_path)
    assert "override body" in text


def test_lenses_for_light_excludes_voice_and_imperfections():
    assert humanize.lenses_for("light") == ("flow", "soul")


def test_lenses_for_medium_adds_voice():
    assert humanize.lenses_for("medium") == ("flow", "soul", "voice")


def test_lenses_for_strong_includes_all_four():
    assert set(humanize.lenses_for("strong")) == {"flow", "soul", "voice", "imperfections"}


def test_guard_flags_changed_number():
    assert humanize.needs_review("freed 11 GB of memory", "freed 12 GB of memory") is True


def test_guard_flags_changed_link():
    assert humanize.needs_review(
        "see [docs](https://a.com)", "see [docs](https://b.com)"
    ) is True


def test_guard_allows_pure_tone_change():
    assert humanize.needs_review(
        "The API adds 5ms and serves as a robust gateway.",
        "The API adds 5ms. That is the whole story.",
    ) is False


def test_guard_allows_tone_change_no_numbers():
    assert humanize.needs_review(
        "This represents a significant improvement to the workflow.",
        "This just makes the workflow better. Noticeably.",
    ) is False


from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, Section


def _draft() -> Draft:
    return Draft(
        title="T",
        idea=IdeaInput(topic="t", provider="claude-cli", model="opus"),
        outline=OutlineProposal(opening_hook="This tool cuts deploy time to a minute."),
        sections=[Section(id="s1", title="The Setup", content_md="The API serves as a gateway. It adds 5ms.")],
        references=[],
    )


def test_parse_locates_target_and_maps_section():
    raw = (
        '{"lenses": {"soul": [{"section": "The Setup", '
        '"target": "The API serves as a gateway.", '
        '"suggestion": "The API is the gateway.", "note": "puffery"}]}}'
    )
    report = humanize.parse_humanize(raw, _draft(), ("soul",))
    lens = next(g for g in report["lenses"] if g["key"] == "soul")
    f = lens["findings"][0]
    assert f["section_id"] == "s1"
    assert f["target"] == "The API serves as a gateway."
    assert f["needs_review"] is False


def test_parse_drops_finding_whose_target_is_absent():
    raw = '{"lenses": {"flow": [{"section": "The Setup", "target": "not in the text", "suggestion": "x", "note": "n"}]}}'
    report = humanize.parse_humanize(raw, _draft(), ("flow",))
    lens = next(g for g in report["lenses"] if g["key"] == "flow")
    assert lens["findings"] == []


def test_parse_maps_opening_section():
    raw = '{"lenses": {"flow": [{"section": "opening", "target": "This tool cuts deploy time to a minute.", "suggestion": "This tool cuts deploys to a minute. Really.", "note": "rhythm"}]}}'
    report = humanize.parse_humanize(raw, _draft(), ("flow",))
    f = next(g for g in report["lenses"] if g["key"] == "flow")["findings"][0]
    assert f["section_id"] == "opening"


def test_parse_tolerates_junk_json():
    report = humanize.parse_humanize("not json", _draft(), ("flow",))
    assert report["lenses"] == [{"key": "flow", "label": "Flow & Rhythm", "findings": []}]
