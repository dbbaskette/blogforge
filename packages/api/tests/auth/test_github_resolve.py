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


async def test_returning_disabled_user_denied_without_mutation(session, monkeypatch) -> None:
    from blogforge.db.models import User
    u = User(github_id=55, github_login="old", status="disabled", role="user")
    session.add(u); await session.commit()
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "old")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    out = await resolve_github_user(session, GithubIdentity(id=55, login="old", email=None, avatar_url="http://new"))
    assert out is None
    await session.refresh(u)
    assert u.avatar_url is None  # not mutated


async def test_email_bound_to_other_github_id_is_conflict(session, monkeypatch) -> None:
    from blogforge.db.models import User
    other = User(github_id=1, github_login="someoneelse", email="shared@x.com", status="approved", role="user")
    session.add(other); await session.commit()
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "newcomer")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    out = await resolve_github_user(session, GithubIdentity(id=2, login="newcomer", email="shared@x.com", avatar_url=None))
    assert out is None


async def test_admin_login_no_admin_row_creates_fresh_admin(session, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "dbbaskette")
    monkeypatch.setenv("BLOGFORGE_GITHUB_ADMIN_LOGIN", "dbbaskette")
    monkeypatch.setenv("BLOGFORGE_ADMIN_EMAIL", "")  # no admin_email to adopt
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    u = await resolve_github_user(session, GithubIdentity(id=500, login="dbbaskette", email="db@x.com", avatar_url=None))
    assert u is not None and u.role == "admin" and u.github_id == 500
