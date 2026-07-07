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
