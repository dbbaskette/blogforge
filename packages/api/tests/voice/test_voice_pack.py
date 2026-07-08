"""Tests for voice pack materialization and export."""
from __future__ import annotations

import pytest
from blogforge.voice.models import VoiceProfile, VoiceSample, VoiceRules
from blogforge.voice.pack import materialize, export_zip


async def test_materialize_writes_valid_pack(tmp_path, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path / "cache"))
    prof = VoiceProfile(
        id="p1",
        user_id="u1",
        persona_identity="The builder who gets it",
        persona_tone="energetic",
        rules=VoiceRules(banished_words=["leverage"], no_em_dashes=True),
        distilled_style_md="Short sentences.",
        samples=[VoiceSample(id="01", kind="text", name="opener", s3_key="k", exemplar=True)],
        version=3,
    )
    d = await materialize(prof, {"01": "This is the opener sample."})
    assert (d / "stylepack.yaml").exists()
    assert "Short sentences." in (d / "style-guide.md").read_text()
    assert (d / "samples" / "01.md").read_text().strip() == "> This is the opener sample."
    from myvoice import compose_prompt
    sys_prompt = compose_prompt(d, format=None, samples=["01"], draft=None)
    assert "The builder who gets it" in sys_prompt
    z = export_zip(d)
    assert z[:2] == b"PK"


async def test_materialize_writes_fingerprint(tmp_path, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path / "cache"))
    prof = VoiceProfile(
        id="p1",
        user_id="u1",
        persona_identity="The builder who gets it",
        persona_tone="energetic",
        rules=VoiceRules(banished_words=["leverage"], no_em_dashes=True),
        distilled_style_md="Short sentences.",
        samples=[VoiceSample(id="01", kind="text", name="opener", s3_key="k", exemplar=True)],
        version=3,
    )
    pack_dir = await materialize(
        prof,
        {"01": "This is the opener sample. It has two sentences to excerpt from."},
    )
    assert (pack_dir / "fingerprint.md").is_file()
    assert "Voice fingerprint" in (pack_dir / "fingerprint.md").read_text()


async def test_materialize_is_cached_by_version(tmp_path, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path / "cache"))
    prof = VoiceProfile(id="p1", user_id="u1", version=5)
    d1 = await materialize(prof, {})
    d2 = await materialize(prof, {})
    assert d1 == d2
