from blogforge.voice.models import VoiceProfile, VoiceSample, VoiceRules


def test_defaults_and_round_trip():
    p = VoiceProfile(id="p1", user_id="u1")
    assert p.name == "My Voice" and p.rules.no_em_dashes is False and p.samples == []
    s = VoiceSample(id="s1", kind="url", name="x", s3_key="k", source_url="http://a")
    assert s.exemplar is False and s.status == "ready"
