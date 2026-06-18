from blogforge.config.settings import Settings


def test_allowlist_parses_csv_lowercased(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "dbbaskette, Alice ,BOB")
    monkeypatch.setenv("BLOGFORGE_GITHUB_ADMIN_LOGIN", "dbbaskette")
    s = Settings()
    assert s.github_allowlist == ["dbbaskette", "alice", "bob"]
    assert s.github_admin_login == "dbbaskette"


def test_allowlist_default_empty() -> None:
    assert Settings().github_allowlist == []
