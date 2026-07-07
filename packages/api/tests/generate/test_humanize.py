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
