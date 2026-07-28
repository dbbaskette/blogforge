from datetime import UTC, datetime

from blogforge.voice.guide import build_voice_guide
from blogforge.voice.models import VoiceProfile, VoiceRules


def assert_paired(prompt: str, instruction: str, rationale_fragment: str) -> None:
    pair = f"Rule: {instruction}\nBecause: "
    assert pair in prompt
    reason = prompt[prompt.index(pair) + len(pair):].splitlines()[0]
    assert rationale_fragment in reason


def _profile(**kw) -> VoiceProfile:
    base = dict(id="p1", user_id="u1", name="My Voice")
    base.update(kw)
    return VoiceProfile(**base)


def test_full_profile_renders_all_sections() -> None:
    p = _profile(
        persona_identity="A pragmatic platform engineer.",
        persona_one_line="Plain, concrete, no hype.",
        persona_tone="Direct",
        distilled_style_md="Short sentences. Concrete nouns.",
        rules=VoiceRules(banished_words=["synergy"], banished_phrases=["at the end of the day"]),
        distilled_at=datetime(2026, 6, 19, tzinfo=UTC),
    )
    md = build_voice_guide(p)
    assert "when you write for me" in md
    assert "pragmatic platform engineer" in md
    assert "Concrete nouns" in md
    assert "synergy" in md
    assert "delve" in md
    assert "Phrases to avoid" in md and "Words to avoid" in md
    assert "writing samples" in md
    assert_paired(
        md,
        "Do not copy the `Rule:` and `Because:` labels or their rationales into "
        "article output.",
        "instructions for the writing process",
    )
    assert_paired(
        md,
        "Follow this voice guide when writing for me.",
        "established voice",
    )
    assert_paired(
        md,
        "Match the persona and style described below.",
        "recognizable voice",
    )
    assert_paired(
        md,
        "Do not use the words, phrases, or patterns under `Avoid these AI-writing tells.`",
        "style defects that make prose sound machine-generated",
    )


def test_empty_profile_does_not_crash() -> None:
    md = build_voice_guide(_profile())
    assert "Not yet distilled" in md
    assert "banished words" not in md.lower()
    assert "delve" in md
