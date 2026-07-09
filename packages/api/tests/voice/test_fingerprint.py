from blogforge.voice.fingerprint import compute_stats, render_fingerprint_md


def test_compute_stats_basic() -> None:
    text = (
        "I build things. Here is the thing about building: it takes time. "
        "Turns out, in practice, the hard part is finishing. "
        "The hard part is finishing well, every single time."
    )
    s = compute_stats([text])
    assert s["word_count"] > 0
    assert len(s["rhythm"]) >= 1
    assert isinstance(s["top_words"], list)
    # "hard part" recurs → it should surface as a signature phrase.
    assert any("hard part" in p for p in s["signature_phrases"])


def test_compute_stats_empty() -> None:
    s = compute_stats([])
    assert s["word_count"] == 0
    assert s["rhythm"] == []
    assert s["signature_phrases"] == []
    assert s["top_words"] == []


def test_render_fingerprint_md_summarizes_rhythm_and_phrases():
    texts = [
        "Short one. Another short one. Here is a much longer sentence that keeps "
        "going to stretch the average out considerably for the reader. Short again. "
        "Here's the thing. Here's the thing about rhythm in real writing samples."
    ]
    md = render_fingerprint_md(texts)
    assert "## Voice fingerprint" in md
    assert "short" in md.lower()
    assert "here's the thing" in md.lower()


def test_render_fingerprint_md_handles_empty():
    md = render_fingerprint_md([])
    assert "not enough sample text" in md
    assert "## Voice fingerprint" in md


async def test_fingerprint_endpoint_empty_profile(authed_client) -> None:
    client, _ = authed_client
    r = client.get("/api/voice/fingerprint")
    assert r.status_code == 200
    body = r.json()
    assert body["sample_count"] == 0
    assert body["dimensions"] is None  # no provider / too little text
    assert body["strength"] == 0
    assert body["signature_phrases"] == []
