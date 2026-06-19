async def test_guide_md_download(authed_client) -> None:
    client, _uid = authed_client
    r = client.get("/api/voice/guide.md")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "voice-guide.md" in r.headers.get("content-disposition", "")
    assert "Writing Voice Guide" in r.text
