# GitHub OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BlogForge's email/password auth with "Sign in with GitHub" (OAuth Authorization Code), gated by an env allowlist, reusing the existing signed-cookie session.

**Architecture:** Two new endpoints (`/api/auth/github/login` + `/callback`) hand-rolled with `httpx`. GitHub HTTP calls live in `auth/github_client.py`; allowlist + user-upsert (incl. adopting the existing admin row) live in `auth/github.py`. The session cookie + `get_current_user` are unchanged. Password endpoints are retired.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), Alembic, httpx (already a dep), React/TS/Vite, vitest, pytest.

> **Reference spec:** `docs/superpowers/specs/2026-06-18-github-oauth-login-design.md`
> **Commands:** API tests `cd /Users/dbbaskette/Projects/BlogForge && .venv/bin/python -m pytest <path> -q`. Web: from `packages/web`, `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vitest run <path>`.

---

## File Structure
- `packages/api/blogforge/config/settings.py` — add GitHub OAuth settings.
- `packages/api/blogforge/db/models.py` — `User` gains `github_id`/`github_login`/`avatar_url`; `password_hash`/`email` nullable.
- `packages/api/alembic/versions/0015_github_identity.py` — migration.
- `packages/api/blogforge/auth/github.py` — `GithubIdentity`, allowlist + `resolve_github_user`.
- `packages/api/blogforge/auth/github_client.py` — GitHub token exchange + identity fetch (httpx).
- `packages/api/blogforge/api/auth_github.py` — `/login` + `/callback` routes.
- `packages/api/blogforge/api/auth.py` — retire password endpoints; extend `MeResponse`.
- `packages/api/blogforge/server.py` — register the new router.
- `packages/web/src/api/auth.ts`, `routes/LoginPage.tsx`, `components/AppShell.tsx`, `routes/AdminPage.tsx` — frontend.
- `scripts/serve-host.sh`, `scripts/run-local.sh`, `manifest.yml` — env wiring + docs.

---

## Task 1: GitHub settings

**Files:** Modify `packages/api/blogforge/config/settings.py`; Test `packages/api/tests/test_github_settings.py`

- [ ] **Step 1: Write the failing test**
```python
# packages/api/tests/test_github_settings.py
import os
from blogforge.config.settings import Settings

def test_allowlist_parses_csv_lowercased(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_GITHUB_ALLOWLIST", "dbbaskette, Alice ,BOB")
    monkeypatch.setenv("BLOGFORGE_GITHUB_ADMIN_LOGIN", "dbbaskette")
    s = Settings()
    assert s.github_allowlist == ["dbbaskette", "alice", "bob"]
    assert s.github_admin_login == "dbbaskette"

def test_allowlist_default_empty() -> None:
    assert Settings().github_allowlist == []
```

- [ ] **Step 2: Run → FAIL** `.venv/bin/python -m pytest packages/api/tests/test_github_settings.py -q` (AttributeError: github_allowlist).

- [ ] **Step 3: Implement** — in `Settings`, after `cors_origins`, add:
```python
    github_client_id: str = ""
    github_client_secret: str = ""
    github_admin_login: str = ""
    # Public base URL for the OAuth callback (e.g. https://blogforge.<tp-domain>).
    # Empty → derived from the incoming request (works on localhost).
    public_url: str = ""
    github_allowlist: Annotated[list[str], NoDecode] = Field(default_factory=list)
```
and add a validator mirroring `split_csv` (lowercased):
```python
    @field_validator("github_allowlist", mode="before")
    @classmethod
    def split_allowlist(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip().lower() for s in v.split(",") if s.strip()]
        return v
```

- [ ] **Step 4: Run → PASS** (2 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/api/blogforge/config/settings.py packages/api/tests/test_github_settings.py
git commit -m "feat(api): GitHub OAuth settings (client id/secret, allowlist, admin login)"
```

---

## Task 2: User model + migration

**Files:** Modify `packages/api/blogforge/db/models.py`; Create `packages/api/alembic/versions/0015_github_identity.py`

- [ ] **Step 1: Update the `User` model.** Add the imports if missing (`BigInteger` from sqlalchemy). In `class User(Base)` change:
```python
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
```
and add after `password_hash`:
```python
    github_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, index=True, nullable=True)
    github_login: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
```

- [ ] **Step 2: Create the migration** `packages/api/alembic/versions/0015_github_identity.py`:
```python
"""github_identity — add github_id/login/avatar; relax email + password_hash."""
from alembic import op
import sqlalchemy as sa

revision = "0015_github_identity"
down_revision = "0014_voice_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("github_id", sa.BigInteger(), nullable=True))
        b.add_column(sa.Column("github_login", sa.String(length=100), nullable=True))
        b.add_column(sa.Column("avatar_url", sa.String(length=512), nullable=True))
        b.alter_column("password_hash", existing_type=sa.Text(), nullable=True)
        b.alter_column("email", existing_type=sa.String(length=320), nullable=True)
        b.create_index("ix_users_github_id", ["github_id"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_index("ix_users_github_id")
        b.drop_column("avatar_url")
        b.drop_column("github_login")
        b.drop_column("github_id")
        b.alter_column("email", existing_type=sa.String(length=320), nullable=False)
        b.alter_column("password_hash", existing_type=sa.Text(), nullable=False)
```
> `batch_alter_table` keeps this portable across SQLite (tests) and Postgres. Confirm `0014_voice_sources` is the current head: `ls packages/api/alembic/versions/ | tail`.

- [ ] **Step 3: Verify the migration applies** on a throwaway SQLite file:
```bash
cd /Users/dbbaskette/Projects/BlogForge
BLOGFORGE_DATABASE_URL="sqlite+aiosqlite:///$(pwd)/.tmp-mig.db" .venv/bin/python -c "
from alembic import command; from alembic.config import Config
import pathlib; r=pathlib.Path('packages/api')
c=Config(str(r/'alembic.ini')); c.set_main_option('script_location', str(r/'alembic'))
c.set_main_option('sqlalchemy.url','sqlite:///./.tmp-mig.db')
command.upgrade(c,'head'); print('upgrade OK'); command.downgrade(c,'0014_voice_sources'); print('downgrade OK')
"; rm -f .tmp-mig.db
```
Expected: `upgrade OK` then `downgrade OK`.

- [ ] **Step 4: Commit**
```bash
git add packages/api/blogforge/db/models.py packages/api/alembic/versions/0015_github_identity.py
git commit -m "feat(api): users.github_id/login/avatar; nullable email + password_hash (migration 0015)"
```

---

## Task 3: Allowlist + user resolution

**Files:** Create `packages/api/blogforge/auth/github.py`; Test `packages/api/tests/auth/test_github_resolve.py`

- [ ] **Step 1: Write the failing tests**
```python
# packages/api/tests/auth/test_github_resolve.py
from sqlalchemy import select
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
    # Pre-seed the legacy admin user (as migration-from-password world would have).
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
```
(Add `packages/api/tests/auth/__init__.py` if the package marker is missing.)

- [ ] **Step 2: Run → FAIL** `.venv/bin/python -m pytest packages/api/tests/auth/test_github_resolve.py -q`.

- [ ] **Step 3: Implement `packages/api/blogforge/auth/github.py`**
```python
"""GitHub identity → BlogForge user: allowlist gate + upsert + admin adoption."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.config import get_settings
from blogforge.db.models import User


@dataclass(frozen=True)
class GithubIdentity:
    id: int
    login: str
    email: str | None
    avatar_url: str | None


def is_allowlisted(login: str) -> bool:
    return login.lower() in get_settings().github_allowlist


async def resolve_github_user(session: AsyncSession, ident: GithubIdentity) -> User | None:
    """Return the BlogForge user for a GitHub identity, or None if not allowed.

    1) match by github_id, 2) reject if not allowlisted, 3) adopt the existing
    admin row for the admin login, else link-by-email or create a new user.
    """
    settings = get_settings()
    now = datetime.now(UTC)

    existing = (
        await session.execute(select(User).where(User.github_id == ident.id))
    ).scalar_one_or_none()
    if existing is not None:
        existing.github_login = ident.login
        existing.avatar_url = ident.avatar_url
        existing.last_login_at = now
        await session.commit()
        return existing if existing.status not in ("disabled", "rejected") else None

    if not is_allowlisted(ident.login):
        return None

    user: User | None = None
    if settings.github_admin_login and ident.login.lower() == settings.github_admin_login.lower():
        # Adopt the existing admin row so My Voice + drafts carry over.
        user = (
            await session.execute(select(User).where(User.role == "admin").limit(1))
        ).scalar_one_or_none()
        if user is None and settings.admin_email:
            user = (
                await session.execute(select(User).where(User.email == settings.admin_email))
            ).scalar_one_or_none()
        role = "admin"
    else:
        role = "user"

    if user is None and ident.email:
        user = (
            await session.execute(select(User).where(User.email == ident.email.lower()))
        ).scalar_one_or_none()

    if user is None:
        user = User(email=(ident.email or None), status="approved", role=role)
        session.add(user)

    user.github_id = ident.id
    user.github_login = ident.login
    user.avatar_url = ident.avatar_url
    user.role = role
    if user.status not in ("disabled", "rejected"):
        user.status = "approved"
    user.last_login_at = now
    await session.commit()
    return user if user.status not in ("disabled", "rejected") else None
```

- [ ] **Step 4: Run → PASS** (3 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/api/blogforge/auth/github.py packages/api/tests/auth/test_github_resolve.py
git commit -m "feat(api): resolve_github_user — allowlist gate + admin adoption"
```

---

## Task 4: GitHub HTTP client

**Files:** Create `packages/api/blogforge/auth/github_client.py`; Test `packages/api/tests/auth/test_github_client.py`

- [ ] **Step 1: Write the failing test** (uses a fake httpx transport via monkeypatch on the module's `httpx`):
```python
# packages/api/tests/auth/test_github_client.py
import httpx, pytest
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
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement `packages/api/blogforge/auth/github_client.py`**
```python
"""GitHub OAuth HTTP calls (token exchange + identity)."""
from __future__ import annotations

import httpx

from blogforge.auth.github import GithubIdentity
from blogforge.config import get_settings
from blogforge.llm.exceptions import ProviderError  # reuse a generic error type

_GH = "https://github.com"
_API = "https://api.github.com"


async def exchange_code(code: str, redirect_uri: str) -> str:
    s = get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_GH}/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": s.github_client_id,
                "client_secret": s.github_client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise ProviderError("GitHub did not return an access token")
    return token


async def fetch_identity(token: str) -> GithubIdentity:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    async with httpx.AsyncClient(timeout=15) as client:
        u = (await client.get(f"{_API}/user", headers=headers)).raise_for_status().json()
        email = u.get("email")
        if not email:
            emails = (await client.get(f"{_API}/user/emails", headers=headers)).json()
            primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
            email = primary.get("email") if primary else None
    return GithubIdentity(
        id=int(u["id"]), login=u["login"], email=email, avatar_url=u.get("avatar_url")
    )
```

- [ ] **Step 4: Run → PASS**.

- [ ] **Step 5: Commit**
```bash
git add packages/api/blogforge/auth/github_client.py packages/api/tests/auth/test_github_client.py
git commit -m "feat(api): GitHub OAuth http client (token exchange + identity)"
```

---

## Task 5: OAuth routes + router registration

**Files:** Create `packages/api/blogforge/api/auth_github.py`; Modify `packages/api/blogforge/server.py`; Test `packages/api/tests/api/test_github_oauth.py`

- [ ] **Step 1: Implement `packages/api/blogforge/api/auth_github.py`**
```python
"""GET /api/auth/github/login + /callback — GitHub OAuth Authorization Code."""
from __future__ import annotations

import secrets
from typing import Literal, cast
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.auth.dependencies import _get_session, _get_signer
from blogforge.auth.github import resolve_github_user
from blogforge.auth.github_client import exchange_code, fetch_identity
from blogforge.auth.sessions import COOKIE_MAX_AGE_SECONDS, COOKIE_NAME
from blogforge.config import get_settings

router = APIRouter(prefix="/api/auth/github", tags=["auth"])

_STATE_COOKIE = "bf_oauth_state"


def _base_url(request: Request) -> str:
    s = get_settings()
    return s.public_url.rstrip("/") if s.public_url else str(request.base_url).rstrip("/")


@router.get("/login")
async def github_login(request: Request) -> RedirectResponse:
    s = get_settings()
    if not s.github_client_id or not s.github_client_secret:
        return RedirectResponse(url="/login?error=github_not_configured", status_code=302)
    state = secrets.token_urlsafe(24)
    redirect_uri = f"{_base_url(request)}/api/auth/github/callback"
    params = urlencode({
        "client_id": s.github_client_id,
        "redirect_uri": redirect_uri,
        "scope": "read:user user:email",
        "state": state,
    })
    resp = RedirectResponse(url=f"https://github.com/login/oauth/authorize?{params}", status_code=302)
    resp.set_cookie(_STATE_COOKIE, state, max_age=600, httponly=True,
                    secure=s.cookie_secure, samesite="lax", path="/")
    return resp


@router.get("/callback")
async def github_callback(
    request: Request, code: str = "", state: str = "",
    session: AsyncSession = Depends(_get_session),
) -> RedirectResponse:
    s = get_settings()
    cookie_state = request.cookies.get(_STATE_COOKIE)
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        return RedirectResponse(url="/login?error=bad_state", status_code=302)
    try:
        token = await exchange_code(code, f"{_base_url(request)}/api/auth/github/callback")
        ident = await fetch_identity(token)
    except Exception:
        return RedirectResponse(url="/login?error=github_failed", status_code=302)

    user = await resolve_github_user(session, ident)
    if user is None:
        resp = RedirectResponse(url="/login?error=not_allowed", status_code=302)
        resp.delete_cookie(_STATE_COOKIE, path="/")
        return resp

    resp = RedirectResponse(url="/", status_code=302)
    resp.delete_cookie(_STATE_COOKIE, path="/")
    resp.set_cookie(
        COOKIE_NAME, _get_signer().sign(user.id, user.session_version),
        max_age=COOKIE_MAX_AGE_SECONDS, httponly=True, secure=s.cookie_secure,
        samesite=cast(Literal["lax", "strict", "none"], s.cookie_samesite), path="/",
    )
    return resp
```

- [ ] **Step 2: Register the router.** In `packages/api/blogforge/server.py`, find where `auth` router is included (grep `from blogforge.api.auth import` / `include_router`) and add alongside it:
```python
from blogforge.api.auth_github import router as auth_github_router
# ...
app.include_router(auth_github_router)
```

- [ ] **Step 3: Test `packages/api/tests/api/test_github_oauth.py`** (uses the `client` TestClient fixture; monkeypatch the github_client functions so no real network):
```python
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
    # seed a matching state cookie
    client.cookies.set("bf_oauth_state", "S")
    r = client.get("/api/auth/github/callback?code=c&state=S", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/"
    assert "blogforge_session" in r.cookies
```

- [ ] **Step 4: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/api/test_github_oauth.py -q`.

- [ ] **Step 5: Commit**
```bash
git add packages/api/blogforge/api/auth_github.py packages/api/blogforge/server.py packages/api/tests/api/test_github_oauth.py
git commit -m "feat(api): GitHub OAuth login + callback routes"
```

---

## Task 6: Retire password endpoints + extend /me

**Files:** Modify `packages/api/blogforge/api/auth.py`; Modify/trim `packages/api/tests/` password tests

- [ ] **Step 1: Remove the password endpoints.** In `api/auth.py`, delete `request_access`, `login`, `change_password` and the `RequestAccessBody`/`LoginBody`/`ChangePasswordBody` models and the now-unused imports (`hash_password`, `verify_password`, `EmailStr`, `IntegrityError`, `select` if unused). Keep `logout`, `me`, `revoke_all_sessions`. Extend `MeResponse`:
```python
class MeResponse(BaseModel):
    id: str
    email: str | None = None
    github_login: str | None = None
    avatar_url: str | None = None
    role: str
    status: str
    last_login_at: datetime | None = None
```
and update the `me` handler to pass `github_login=current.github_login, avatar_url=current.avatar_url, email=current.email`.

- [ ] **Step 2: Trim password tests.** `grep -rln "/api/auth/login\|/api/auth/request\|change-password" packages/api/tests` — delete the tests asserting those endpoints. If `_seed_approved_user` in `conftest.py` sets `password_hash`, leave it (column is nullable; a value is fine).

- [ ] **Step 3: Run the API suite** `.venv/bin/python -m pytest packages/api -q` → all pass (the removed endpoints' tests are gone; everything else green).

- [ ] **Step 4: Commit**
```bash
git add packages/api/blogforge/api/auth.py packages/api/tests
git commit -m "feat(api): retire password auth endpoints; /me returns github identity"
```

---

## Task 7: Frontend — Sign in with GitHub

**Files:** Modify `packages/web/src/api/auth.ts`, `routes/LoginPage.tsx`, `components/AppShell.tsx`, `routes/AdminPage.tsx`

- [ ] **Step 1: `api/auth.ts`** — extend `CurrentUser`, drop password fns:
```ts
export interface CurrentUser {
  id: string;
  email: string | null;
  github_login: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  status: "approved" | "pending" | "rejected" | "disabled";
  last_login_at: string | null;
}
export const getMe = (): Promise<CurrentUser> => api<CurrentUser>("/api/auth/me");
export const logout = (): Promise<void> => api("/api/auth/logout", { method: "POST" });
export const revokeAllSessions = (): Promise<void> =>
  api("/api/auth/sessions/revoke-all", { method: "POST" });
```
(Remove `login`, `requestAccess`, `changePassword`.)

- [ ] **Step 2: `routes/LoginPage.tsx`** — replace the form/tabs with a single GitHub button + error banner. Keep the existing glass card shell; the body becomes:
```tsx
const params = new URLSearchParams(window.location.search);
const error = params.get("error");
const ERROR_MSG: Record<string, string> = {
  not_allowed: "That GitHub account isn't on the allowlist.",
  bad_state: "Login expired — please try again.",
  github_failed: "GitHub sign-in failed — please try again.",
  github_not_configured: "GitHub login isn't configured on this server.",
};
// ...inside the card, replacing the form:
{error && (
  <p className="text-sm px-3 py-2 rounded-nb-sm mb-3"
     style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}>
    {ERROR_MSG[error] ?? "Sign-in error."}
  </p>
)}
<a href="/api/auth/github/login" className="nb-btn nb-btn-primary w-full justify-center">
  Sign in with GitHub
</a>
```
Remove the email/password inputs, the Sign in/Request access tabs, and their handlers/imports.

- [ ] **Step 3: `components/AppShell.tsx`** — in the top bar, show the avatar + login when present: replace the `{user.email}` span with:
```tsx
{user.avatar_url && (
  <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
)}
<span className="text-xs text-muted hidden sm:block">{user.github_login ?? user.email}</span>
```

- [ ] **Step 4: `routes/AdminPage.tsx`** — wherever it renders a user's `email`, render `user.github_login ?? user.email` (the admin users list). Keep disable/promote actions.

- [ ] **Step 5: Verify** from `packages/web`:
```
./node_modules/.bin/tsc --noEmit   # PASS
./node_modules/.bin/vitest run     # update/remove any LoginPage test that drove the password form; rest green
```
If `tests/routes/LoginPage.test.tsx` asserts the email/password form, rewrite it to assert the "Sign in with GitHub" link points at `/api/auth/github/login`.

- [ ] **Step 6: Commit**
```bash
git add packages/web/src
git commit -m "feat(web): Sign in with GitHub; drop email/password UI; avatar in top bar"
```

---

## Task 8: Env wiring + OAuth-app docs

**Files:** Modify `scripts/serve-host.sh`, `scripts/run-local.sh`, `manifest.yml`; Create `docs/github-oauth-setup.md`

- [ ] **Step 1: Add GitHub env to the local runners.** In `scripts/serve-host.sh` and `scripts/run-local.sh`, alongside the other `export BLOGFORGE_*` lines, add (read-through from the host env so the user can set them without editing the script):
```bash
export BLOGFORGE_GITHUB_CLIENT_ID="${BLOGFORGE_GITHUB_CLIENT_ID:-}"
export BLOGFORGE_GITHUB_CLIENT_SECRET="${BLOGFORGE_GITHUB_CLIENT_SECRET:-}"
export BLOGFORGE_GITHUB_ALLOWLIST="${BLOGFORGE_GITHUB_ALLOWLIST:-dbbaskette}"
export BLOGFORGE_GITHUB_ADMIN_LOGIN="${BLOGFORGE_GITHUB_ADMIN_LOGIN:-dbbaskette}"
export BLOGFORGE_PUBLIC_URL="${BLOGFORGE_PUBLIC_URL:-http://localhost:7880}"   # serve-host: 7880; run-local: 7882
```
(Use the correct port per script.)

- [ ] **Step 2: `manifest.yml`** — under `env:`, add the non-secret keys and a comment that secrets go via `cf set-env`:
```yaml
      BLOGFORGE_GITHUB_ALLOWLIST: dbbaskette
      BLOGFORGE_GITHUB_ADMIN_LOGIN: dbbaskette
      # Secrets at deploy time:
      #   cf set-env blogforge BLOGFORGE_GITHUB_CLIENT_ID <id>
      #   cf set-env blogforge BLOGFORGE_GITHUB_CLIENT_SECRET <secret>
      #   cf set-env blogforge BLOGFORGE_PUBLIC_URL https://<app-route>
```

- [ ] **Step 3: `docs/github-oauth-setup.md`** — write the exact OAuth-App steps:
  - github.com → Settings → Developer settings → OAuth Apps → New OAuth App.
  - Homepage URL: the app URL. Authorization callback URL: `{base}/api/auth/github/callback` (register both `http://localhost:7880/...` and the TP route — or one app per environment).
  - Copy Client ID + generate a Client secret; export `BLOGFORGE_GITHUB_CLIENT_ID/SECRET` (local) or `cf set-env` (TP).
  - Set `BLOGFORGE_GITHUB_ALLOWLIST` to the permitted logins and `BLOGFORGE_GITHUB_ADMIN_LOGIN` to yours.

- [ ] **Step 4: Commit**
```bash
git add scripts/serve-host.sh scripts/run-local.sh manifest.yml docs/github-oauth-setup.md
git commit -m "docs+config: GitHub OAuth env wiring + setup guide"
```

---

## Self-Review Notes
- **Spec coverage:** model/migration → T2; OAuth flow → T4+T5; allowlist+admin adoption → T3; config → T1; frontend → T7; retired password endpoints → T6; env/OAuth-app prereq → T8. Testing embedded per task.
- **Type consistency:** `GithubIdentity(id, login, email, avatar_url)` defined in T3, used in T4/T5; `resolve_github_user(session, ident)` consistent; `MeResponse`/`CurrentUser` gain the same `github_login`/`avatar_url`/nullable-email fields (T6/T7).
- **Adapt-on-contact:** confirm the alembic head is `0014_voice_sources` (T2); confirm `server.py`'s router-include style (T5 Step 2); the exact `AdminPage`/`LoginPage` markup (T7) — match what's there.
- **Migration test note:** if the test suite applies migrations on SQLite via the lifespan, `batch_alter_table` (T2) is required and used; if it uses `create_all`, the new columns come from the updated model — both covered.
