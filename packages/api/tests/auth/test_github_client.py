import httpx
from blogforge.auth import github_client as gc

def _mock(monkeypatch, handler) -> None:
    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    def factory(*a, **k):
        k["transport"] = transport
        return real(*a, **k)
    monkeypatch.setattr(gc.httpx, "AsyncClient", factory)

async def test_exchange_and_fetch(monkeypatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "github.com":
            return httpx.Response(200, json={"access_token": "tok"})
        if req.url.path == "/user":
            return httpx.Response(200, json={"id": 5, "login": "alice", "avatar_url": "http://a"})
        if req.url.path == "/user/emails":
            return httpx.Response(200, json=[{"email": "a@x.com", "primary": True, "verified": True}])
        return httpx.Response(404)
    _mock(monkeypatch, handler)
    monkeypatch.setenv("BLOGFORGE_GITHUB_CLIENT_ID", "id")
    monkeypatch.setenv("BLOGFORGE_GITHUB_CLIENT_SECRET", "secret")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    tok = await gc.exchange_code("code", "http://localhost/cb")
    assert tok == "tok"
    ident = await gc.fetch_identity(tok)
    assert ident.id == 5 and ident.login == "alice" and ident.email == "a@x.com"
