from blogforge.auth.github import GithubIdentity, resolve_github_user
from blogforge.db.models import User


async def test_non_allowlisted_returns_none(session, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "alice")
    from blogforge.config import settings as s
    s.get_settings.cache_clear()
    out = await resolve_github_user(session, GithubIdentity(id=1, login="mallory", email=None, avatar_url=None))
    assert out is None


async def test_allowlisted_new_user_created_approved(session, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "alice")
    from blogforge.config import settings as s
    s.get_settings.cache_clear()
    u = await resolve_github_user(session, GithubIdentity(id=7, login="Alice", email="a@x.com", avatar_url="http://a"))
    assert u is not None and u.github_id == 7 and u.role == "user" and u.status == "approved"


async def test_admin_login_adopts_existing_admin_row(session, monkeypatch) -> None:
    from blogforge.auth.passwords import hash_password
    admin = User(email="dbbaskette@gmail.com", password_hash=hash_password("x"), status="approved", role="admin")
    session.add(admin); await session.flush()
    admin_id = admin.id
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "dbbaskette")
    monkeypatch.setenv("BLOGFORGE_GITHUB_ADMIN_LOGIN", "dbbaskette")
    monkeypatch.setenv("BLOGFORGE_ADMIN_EMAIL", "dbbaskette@gmail.com")
    from blogforge.config import settings as s
    s.get_settings.cache_clear()
    u = await resolve_github_user(session, GithubIdentity(id=99, login="dbbaskette", email="dbbaskette@gmail.com", avatar_url=None))
    assert u is not None and u.id == admin_id and u.github_id == 99 and u.role == "admin"
