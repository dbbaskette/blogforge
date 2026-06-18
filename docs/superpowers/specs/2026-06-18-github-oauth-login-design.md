# GitHub OAuth Login — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan.
**Scope:** Replace BlogForge's email/password auth with **Sign in with GitHub** (OAuth Authorization Code). Works identically locally and on Tanzu Platform. First of a multi-sub-project epic (per-user API keys → bound TP model → TP deploy follow).

## Goal

- One-click **"Sign in with GitHub"** replaces the email/password form and the request-access/approve flow.
- Access gated by an **env allowlist** of GitHub logins; one designated login is admin.
- The signed-cookie **session** and `get_current_user` are reused unchanged — only the *login mechanism* changes.
- The existing admin user's data (**My Voice** profile + drafts) is preserved by **adopting** that row on the admin's first GitHub sign-in.

## Decisions (locked)

- GitHub **replaces** email/password (not added alongside).
- Access control = **env allowlist** (`BLOGFORGE_GITHUB_ALLOWLIST`), not org membership or DB approval.
- Admin = `BLOGFORGE_GITHUB_ADMIN_LOGIN`; on first sign-in it adopts the existing admin row.
- Blob store stays **S3** (GitHub-repo storage is a later sub-project).
- OAuth implemented **hand-rolled with `httpx`** (no new dependency; `httpx>=0.27` already present).

## Architecture

### 1 · User model + migration (`db/models.py`, alembic `0015_github_identity`)
Add to `users`:
- `github_id: int | None` — GitHub numeric id, unique, indexed (the stable identity key).
- `github_login: str | None` — handle (display + allowlist match).
- `avatar_url: str | None`.

Relax:
- `password_hash` → **nullable** (retained, unused by login; kept so test fixtures + any legacy rows validate).
- `email` → **nullable** (GitHub email can be private/withheld).

Migration `0015`: add the three columns (nullable), make `password_hash`/`email` nullable. No data backfill in the migration itself — data adoption happens at login time (below), so the migration is reversible and safe.

### 2 · OAuth endpoints (`api/auth_github.py`)
- `GET /api/auth/github/login`
  - Build `state` (random token), store it in a short-lived signed, httponly cookie (`bf_oauth_state`).
  - 302 → `https://github.com/login/oauth/authorize?client_id=…&redirect_uri={base}/api/auth/github/callback&scope=read:user%20user:email&state=…`.
- `GET /api/auth/github/callback?code&state`
  - Verify `state` against the `bf_oauth_state` cookie (mismatch/missing → 403); clear the state cookie.
  - `POST https://github.com/login/oauth/access_token` (`client_id`, `client_secret`, `code`) with `Accept: application/json` → `access_token`.
  - `GET https://api.github.com/user` (Bearer) → `{ id, login, avatar_url }`; `GET /user/emails` → primary verified email (best-effort; may be empty).
  - **Allowlist + upsert** (see §3) → set the session cookie via `SessionSigner.sign(user.id, user.session_version)` → 302 → `/`.
  - Errors (token exchange fail, GitHub 4xx) → 302 → `/login?error=…` with a friendly message.
- `base` = `settings.public_url` if set, else the request's scheme+host (so localhost and the TP route both work).

### 3 · Access control + upsert (`auth/github.py` helper)
`async def resolve_github_user(session, *, github_id, login, email, avatar_url) -> User | None`:
1. Find by `github_id` → return it (update login/avatar/last_login).
2. Else if `login` **not** in `BLOGFORGE_GITHUB_ALLOWLIST` (case-insensitive) → return `None` (caller raises 403; no row created).
3. Else (allowlisted, first GitHub sign-in for this id):
   - If `login == BLOGFORGE_GITHUB_ADMIN_LOGIN`: **adopt** the existing admin row — pick the lone `role == "admin"` user (fallback: user whose `email == settings.admin_email`); set its `github_id`/`github_login`/`avatar_url`, `role="admin"`, `status="approved"`. This carries over My Voice + drafts.
   - Else: find a row by matching verified `email` (link legacy email users) or create a new `User(role="user", status="approved", github_id=…)`.
4. If the resolved user's `status` is `disabled`/`rejected` → caller raises 403 ("access disabled").

`status` stays meaningful: an admin can disable a user in `/admin` and the allowlist still applies on next login.

### 4 · Config (`config/settings.py`)
New `BLOGFORGE_*` settings:
- `github_client_id: str = ""`, `github_client_secret: str = ""`
- `github_allowlist: list[str]` (comma-separated env → list, lowercased)
- `github_admin_login: str = ""`
- `public_url: str = ""` (e.g. `https://blogforge.<tp-domain>`; empty → derive from request)

If `github_client_id`/`secret` are empty, the login route returns a clear "GitHub login isn't configured" error (so a misconfigured deploy fails loudly, not silently).

**Prerequisite (documented, not code):** register a GitHub OAuth App with callback `{base}/api/auth/github/callback` (one app with both the localhost and TP callback URLs, or two apps). Provide client id/secret via env (`serve-host.sh`/`run-local.sh` exports locally; `cf set-env` on TP).

### 5 · Frontend (`routes/LoginPage.tsx`, `api/auth.ts`, `AppShell.tsx`)
- `LoginPage`: replace the form/tabs with a single **"Sign in with GitHub"** button → `window.location = "/api/auth/github/login"`. Show an inline error if `?error=` is present.
- `api/auth.ts`: drop `login`/`requestAccess`/`changePassword`; keep `logout` + `useMe`. `Me` gains `github_login`, `avatar_url`.
- `AppShell` top bar: show the avatar + `github_login`; keep Sign out.
- `/admin` users list: show `github_login` instead of email-centric columns; keep disable/promote.

### 6 · Retired
- Endpoints: `POST /api/auth/login`, `/api/auth/request`, `/api/auth/change-password` (+ their request models). `passwords.py` retained for test fixtures only.
- Web: email/password form, "Request access" tab, change-password UI.

## Testing
- **`resolve_github_user`** (mocked DB session): allowlisted new login → user created `approved`; admin login → adopts the pre-seeded admin row (asserts `github_id` set on the *same* id that owns the drafts, role stays admin); non-allowlisted → `None`; disabled user → flagged.
- **Callback route** (mock GitHub token + `/user` via `respx`/monkeypatched httpx): happy path sets the session cookie + 302 to `/`; bad `state` → 403; non-allowlisted → 403/redirect with error.
- Existing suites: most authed tests sign cookies directly (`_signed_client`), so they keep working; remove the password-login/request tests; update `_seed_approved_user` to not require a password (or pass a placeholder, since `password_hash` is nullable).

## Out of scope
- Per-user API keys, the bound TP model, TP deploy finalization (later sub-projects).
- GitHub-repo blob store (S3 stays).
- Refresh tokens / re-auth (GitHub access tokens are only used at login to fetch identity; not stored).

## Success criteria
1. Visiting `/login` shows only "Sign in with GitHub"; the flow round-trips and lands authenticated on `/`.
2. Only allowlisted GitHub logins can sign in; the admin login lands as admin with **My Voice + drafts intact**.
3. Session/cookie behavior (14-day cookie, sign-out) unchanged; `get_current_user` unchanged.
4. Works locally (`serve-host.sh`) and is TP-ready (callback via `BLOGFORGE_PUBLIC_URL`); no new runtime dependency.
5. New tests pass; existing suite stays green after the password-test removal.
