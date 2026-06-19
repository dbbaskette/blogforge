import io, zipfile


def _archive() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Profile.csv", "Headline,Summary\r\n\"Head of X\",\"I build platforms and write about them.\"\r\n")
        z.writestr("Articles/Articles/a.html",
                   "<html><head><title>On Platforms</title></head><body><p>" + ("Real prose. " * 30) + "</p></body></html>")
    return buf.getvalue()


def test_import_prefills_persona_and_samples(authed_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    client, _uid = authed_client
    before = len(client.get("/api/voice").json()["samples"])
    r = client.post("/api/voice/import/linkedin", files={"file": ("export.zip", _archive(), "application/zip")})
    assert r.status_code == 200, r.text
    prof = r.json()
    assert len(prof["samples"]) >= before + 2
    assert prof["persona_one_line"] or prof["persona_identity"]


def test_import_bad_archive_400(authed_client) -> None:
    client, _ = authed_client
    r = client.post("/api/voice/import/linkedin", files={"file": ("x.zip", b"not a zip", "application/zip")})
    assert r.status_code == 400
