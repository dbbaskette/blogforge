import blogforge.api.auth_github as ag
from blogforge.auth.github import GithubIdentity

def test_login_redirects_to_github(client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_CLIENT_ID", "id")
    monkeypatch.setenv("BLOGFORGE_GITHUB_CLIENT_SECRET", "sec")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    r = client.get("/api/auth/github/login", follow_redirects=False)
    assert r.status_code == 302 and "github.com/login/oauth/authorize" in r.headers["location"]
    assert "bf_oauth_state" in r.cookies

def test_callback_bad_state_redirects(client) -> None:
    r = client.get("/api/auth/github/callback?code=x&state=y", follow_redirects=False)
    assert r.status_code == 302 and "error=bad_state" in r.headers["location"]

def test_callback_happy_path_sets_session(client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "alice")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    async def fake_exchange(code, redirect_uri): return "tok"
    async def fake_fetch(token): return GithubIdentity(id=42, login="alice", email="a@x.com", avatar_url=None)
    monkeypatch.setattr(ag, "exchange_code", fake_exchange)
    monkeypatch.setattr(ag, "fetch_identity", fake_fetch)
    client.cookies.set("bf_oauth_state", "S")
    r = client.get("/api/auth/github/callback?code=c&state=S", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/"
    assert "blogforge_session" in r.cookies


def test_callback_oauth_denied(client) -> None:
    client.cookies.set("bf_oauth_state", "S")
    r = client.get("/api/auth/github/callback?state=S&error=access_denied", follow_redirects=False)
    assert r.status_code == 302 and "error=oauth_denied" in r.headers["location"]

def test_callback_missing_state_cookie(client) -> None:
    # Ensure no state cookie is present — delete it if carried over from a prior test.
    try:
        client.cookies.delete("bf_oauth_state")
    except Exception:
        pass
    r = client.get("/api/auth/github/callback?code=c&state=S", follow_redirects=False)
    assert r.status_code == 302 and "error=bad_state" in r.headers["location"]
