from pathlib import Path

import pytest

from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, Section
from blogforge.generate import humanize
from blogforge.llm.base import LLMResponse


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
    assert humanize.needs_review("see [docs](https://a.com)", "see [docs](https://b.com)") is True


def test_guard_allows_pure_tone_change():
    assert (
        humanize.needs_review(
            "The API adds 5ms and serves as a robust gateway.",
            "The API adds 5ms. That is the whole story.",
        )
        is False
    )


def test_guard_allows_tone_change_no_numbers():
    assert (
        humanize.needs_review(
            "This represents a significant improvement to the workflow.",
            "This just makes the workflow better. Noticeably.",
        )
        is False
    )


def _draft() -> Draft:
    return Draft(
        title="T",
        idea=IdeaInput(topic="t", provider="claude-cli", model="opus"),
        outline=OutlineProposal(opening_hook="This tool cuts deploy time to a minute."),
        sections=[
            Section(
                id="s1",
                title="The Setup",
                content_md="The API serves as a gateway. It adds 5ms.",
            )
        ],
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
    raw = (
        '{"lenses": {"flow": [{"section": "The Setup", "target": "not in the text", '
        '"suggestion": "x", "note": "n"}]}}'
    )
    report = humanize.parse_humanize(raw, _draft(), ("flow",))
    lens = next(g for g in report["lenses"] if g["key"] == "flow")
    assert lens["findings"] == []


def test_parse_drops_opening_target_guardrail():
    # The opening hook is GEO-scored; Humanize must never rewrite it, so a
    # finding targeting "opening" is dropped (sid resolves to None) rather than
    # applied.
    raw = (
        '{"lenses": {"flow": [{"section": "opening", '
        '"target": "This tool cuts deploy time to a minute.", '
        '"suggestion": "This tool cuts deploys to a minute. Really.", '
        '"note": "rhythm"}]}}'
    )
    report = humanize.parse_humanize(raw, _draft(), ("flow",))
    flow = next(g for g in report["lenses"] if g["key"] == "flow")
    assert flow["findings"] == []


def test_draft_text_excludes_opening_hook():
    # The opening hook is never sent to the model — the guardrail keeps Humanize
    # off the GEO-scored answer-first sentence.
    text = humanize._draft_text(_draft())
    assert "This tool cuts deploy time to a minute." not in text
    assert "The Setup" in text  # body sections are still included


def test_parse_matches_section_with_emphasized_title():
    # Stored titles can carry markdown emphasis (e.g. a pasted "## **The Setup**").
    # The model echoes the clean title "The Setup"; both sides must normalize the
    # same way (strip_inline_emphasis) or the finding is silently dropped.
    draft = Draft(
        title="T",
        idea=IdeaInput(topic="t", provider="claude-cli", model="opus"),
        outline=OutlineProposal(opening_hook="Opening line."),
        sections=[
            Section(
                id="s1",
                title="**The Setup**",
                content_md="The API serves as a gateway. It adds 5ms.",
            )
        ],
        references=[],
    )
    raw = (
        '{"lenses": {"soul": [{"section": "The Setup", '
        '"target": "The API serves as a gateway.", '
        '"suggestion": "The API is the gateway.", "note": "puffery"}]}}'
    )
    report = humanize.parse_humanize(raw, draft, ("soul",))
    f = next(g for g in report["lenses"] if g["key"] == "soul")["findings"][0]
    assert f["section_id"] == "s1"


def test_parse_tolerates_junk_json():
    report = humanize.parse_humanize("not json", _draft(), ("flow",))
    assert report["lenses"] == [{"key": "flow", "label": "Flow & Rhythm", "findings": []}]


def test_score_full_when_no_findings():
    report = {"lenses": [{"key": "flow", "label": "Flow & Rhythm", "findings": []}]}
    assert humanize.score_report(report) == 100


def test_score_docks_but_caps_per_lens():
    many = [{"lens": "flow"} for _ in range(20)]
    report = {"lenses": [{"key": "flow", "label": "Flow & Rhythm", "findings": many}]}
    # 20 findings in one lens cannot dock more than the per-lens cap (15).
    assert humanize.score_report(report) == 85


class _JsonLLM:
    name = "json"

    def __init__(self, text: str) -> None:
        self._text = text

    async def complete(self, **_kw):
        return LLMResponse(
            text=self._text, input_tokens=1, output_tokens=1, model="m", finish_reason="stop"
        )


def _fake_pack(tmp_path):
    # NOTE: the plan's fixture used a schema the real Manifest model rejects
    # (missing `spec_version`/`pack`, an extra `spec` field). Corrected to match
    # the working fixture in tests/generate/test_geo.py::_fake_pack.
    (tmp_path / "stylepack.yaml").write_text(
        "spec_version: '1.0'\npack:\n  slug: dan\n  name: Dan\n  version: '1.0'\n  author: Dan\n"
        "persona:\n  identity: A\n  one_line: B\n",
        encoding="utf-8",
    )
    (tmp_path / "style-guide.md").write_text("# guide\n", encoding="utf-8")
    return tmp_path


@pytest.mark.asyncio
async def test_analyze_humanize_light_only_runs_flow_and_soul(tmp_path):
    raw = '{"lenses": {"flow": [], "soul": [], "voice": [], "imperfections": []}}'
    report = await humanize.analyze_humanize(
        _draft(), _fake_pack(tmp_path), _JsonLLM(raw), intensity="light", model="m"
    )
    keys = [g["key"] for g in report["lenses"]]
    assert keys == ["flow", "soul"]
    assert report["intensity"] == "light"
    assert report["score"] == 100
