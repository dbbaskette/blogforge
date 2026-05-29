# Phase A — auth + multi-tenant Postgres + Docker + Tanzu

**Date:** 2026-05-27
**Status:** Approved (shape) · implementation plan to follow
**Companion to:** 2026-05-27-research-stage-and-references-design.md (Phase B, blocked on this)

## Motivation

BlogForge today is single-user and filesystem-backed (`~/.blogforge/drafts/`). To run as a hosted multi-tenant app on Tanzu Platform, every draft needs to be scoped to a user, every authenticated request needs a session, and storage needs to move to managed services (Postgres + S3-compatible object storage). This phase replaces the on-disk store, adds auth, and lays the foundation that Phase B (research/references) will build on.

## Scope

In: Postgres-backed data layer · email/password login · admin approval workflow · seeded admin user · CORS-enabled API · same `/api/drafts` surface but scoped by current user · Docker Compose with Postgres + MinIO · Tanzu Platform manifest with bound Postgres + SeaweedFS S3 service · Alembic migrations.

Out: References / ideation / file uploads (Phase B). Forgot-password flow. Email verification. SSO. Per-user provider keys (still pulled from myvoice config for v1 — same single source).

## Workflow — what a user sees

```
[Unauthenticated] /login
   ├── Sign in     -> session cookie, redirect to /
   └── Request access -> POST /api/auth/request -> "Your request has been sent"

[Admin] /admin
   ├── Pending requests table (approve / reject)
   └── Users table (deactivate, promote to admin)

[Authenticated user] / and beyond
   - Top bar shows email + sign-out button.
   - /api/drafts returns only drafts where user_id = current_user.id.
   - All mutations enforce ownership; cross-user access returns 404 (not 403, to avoid leaking ID existence).
```

## Data model (Postgres)

### `users`

| column       | type         | notes                                                                 |
|--------------|--------------|-----------------------------------------------------------------------|
| id           | uuid PK      | gen_random_uuid()                                                     |
| email        | text UNIQUE  | citext-style — stored lower-cased                                     |
| password_hash| text         | argon2id                                                              |
| status       | text         | `pending` \| `approved` \| `rejected` \| `disabled`                   |
| role         | text         | `user` \| `admin`                                                     |
| created_at   | timestamptz  | now()                                                                 |
| approved_at  | timestamptz? | set when status flips to approved                                     |
| approved_by  | uuid?        | FK -> users.id (the admin who approved)                               |
| last_login_at| timestamptz? |                                                                       |

Seeded at app startup (idempotent): one user `dbbaskette@gmail.com` / `VMware0!` with `status=approved`, `role=admin`. Password is hashed at seed time; on every boot we check if the row exists and skip if so. (The plaintext password lives in an env var `BLOGFORGE_ADMIN_PASSWORD` with default `VMware0!` for local dev — production overrides via Tanzu env var.)

### `drafts`

| column       | type           | notes                                              |
|--------------|----------------|---------------------------------------------------|
| id           | uuid PK        |                                                   |
| user_id      | uuid           | FK -> users.id, ON DELETE CASCADE, INDEX          |
| title        | text           |                                                   |
| stage        | text           | `idea` \| `outline` \| `sections`                 |
| idea         | jsonb          | `IdeaInput`                                       |
| outline      | jsonb?         | `OutlineProposal`                                 |
| created_at   | timestamptz    | now()                                             |
| updated_at   | timestamptz    | now() on every update                             |
| deleted_at   | timestamptz?   | soft-delete (was "trash" on disk)                 |

### `sections`

| column            | type         | notes                                                    |
|-------------------|--------------|----------------------------------------------------------|
| id                | text PK      | the same slugged id we already use                       |
| draft_id          | uuid         | FK -> drafts.id, ON DELETE CASCADE, INDEX                |
| position          | int          | 0-based ordering                                         |
| title             | text         |                                                          |
| brief             | text         |                                                          |
| content_md        | text         | the prose                                                |
| status            | text         | `empty` \| `generating` \| `ready` \| `failed` \| `edited` |
| last_generated_at | timestamptz? |                                                          |
| last_error        | text?        | persisted from PR #11                                    |
| word_count        | int          |                                                          |

Unique index on `(draft_id, position)` to keep ordering stable.

### `jobs` (in-memory today)

Stays in-memory for v1 (single-process API server). Phase B may move this to Redis if we need horizontal scaling on Tanzu.

## Migrations

Alembic. Single initial migration `0001_initial.sql` creates the three tables above plus indexes. `alembic upgrade head` runs at app startup (FastAPI lifespan event); on prod the migration runs once on first boot, on subsequent boots it's a no-op.

Existing `~/.blogforge/drafts/` data is **not** migrated. The directory is left alone on disk (so the user can recover by hand if needed); we just stop reading from it.

## Storage layer

`blogforge.drafts.store.DraftStore` is replaced by `blogforge.drafts.store.SqlDraftStore`:

- Same public surface (`list_for_user`, `get`, `create`, `update`, `delete`, etc.) but every method takes a `user_id`.
- Returns the same `Draft` / `DraftSummary` pydantic models — the rest of the API layer doesn't change shape.
- Backed by SQLAlchemy 2.0 async + asyncpg.

Why SQLAlchemy 2.0 async over SQLModel: SQLAlchemy's async is mature, the typing in 2.0 is solid, and pydantic v2 models compose cleanly via `model_validate(orm_obj, from_attributes=True)`. SQLModel adds a layer we don't need.

## Auth

### Endpoints (all under `/api/auth/`)

| Method | Path                | Body                                          | Result                                    |
|--------|---------------------|-----------------------------------------------|-------------------------------------------|
| POST   | `request`           | `{ email, password }`                         | 201; row inserted with `status=pending`   |
| POST   | `login`             | `{ email, password }`                         | 200 + Set-Cookie; or 401                  |
| POST   | `logout`            | —                                             | 204 + clears cookie                       |
| GET    | `me`                | —                                             | `{ id, email, role, status }` or 401      |

### Admin endpoints (`/api/admin/`, require `role=admin`)

| Method | Path                          | Body                          | Result                       |
|--------|-------------------------------|-------------------------------|------------------------------|
| GET    | `users`                       | —                             | `User[]` (all)               |
| GET    | `users?status=pending`        | —                             | `User[]` filtered            |
| POST   | `users/{id}/approve`          | —                             | Updated user                 |
| POST   | `users/{id}/reject`           | —                             | Updated user                 |
| POST   | `users/{id}/disable`          | —                             | Updated user                 |
| POST   | `users/{id}/promote`          | —                             | role -> admin                |

Cross-cutting middleware: every non-auth route requires an authenticated, approved session. Pending / rejected / disabled users see 403. Admin endpoints additionally check `role=admin`.

### Session cookies

- Library: `itsdangerous.URLSafeSerializer` for signed cookie containing `{ user_id, issued_at }`.
- Cookie attributes: `HttpOnly=True`, `SameSite=None`, `Secure=True`.
- `Secure=True` over plain HTTP localhost is accepted by Chrome / Firefox in dev because `localhost` is treated as a secure context. Production over HTTPS is unaffected.
- TTL: 14 days. Renewed on every request that hits an authenticated route.
- Server-side allow-list: a `revoked_sessions` table (or a Redis set later) is *not* needed for v1 — to log out a single client we just clear their cookie; to invalidate everywhere we rotate the cookie-signing secret in env.

### Password hashing

`argon2-cffi`. Default parameters (well-tuned defaults — `time_cost=3, memory_cost=64MB, parallelism=4`). No pepper for v1.

### CORS

`fastapi.middleware.cors.CORSMiddleware` with:
- `allow_origins`: from `BLOGFORGE_CORS_ORIGINS` env (comma-separated). Default in dev: `http://localhost:7881`. Empty in prod (API and web share origin).
- `allow_credentials=True`
- `allow_methods=["*"]`
- `allow_headers=["*"]`
- `expose_headers=["x-job-id"]` (for the existing SSE job pattern)

## UI

### New routes

- `/login` — single page with two tabs: **Sign in** (email + password + Sign in) and **Request access** (email + password + confirm + Submit). Both tabs are in the same Notebook-style centred card.
- `/admin` — admin-only. Two sections: **Pending requests** (list with Approve / Reject buttons) and **All users** (list with Disable / Promote-to-admin actions).

### Updated routes

- `/` (DraftsPage) and `/drafts/:id` (DraftPage) become protected — wrapping `<RequireAuth>` redirects to `/login` if no session.
- `AppShell.tsx` top bar gains the current user's email and a Sign out button. If `role=admin`, an "Admin" link surfaces.

### New components

- `routes/LoginPage.tsx` — tabs + forms.
- `routes/AdminPage.tsx` — tables.
- `components/RequireAuth.tsx` — route guard. Uses a React Query `useMe()` hook that fetches `/api/auth/me` once and caches.

### Mutations / hooks

- `useMe()` — current user.
- `useLogin()` / `useLogout()` / `useRequestAccess()`.
- `useApproveUser()` / `useRejectUser()` / `useDisableUser()` / `usePromoteUser()`.

All API calls now include `credentials: "include"` so the session cookie rides along cross-origin in dev.

## Configuration

Env vars (loaded via pydantic-settings):

```
BLOGFORGE_DATABASE_URL          postgresql+asyncpg://user:pass@host:5432/blogforge
BLOGFORGE_ADMIN_EMAIL           dbbaskette@gmail.com           (seed)
BLOGFORGE_ADMIN_PASSWORD        VMware0!                       (seed, hashed at boot)
BLOGFORGE_SESSION_SECRET        random 64-char hex             (used to sign cookies)
BLOGFORGE_CORS_ORIGINS          http://localhost:7881          (dev only)
BLOGFORGE_S3_ENDPOINT_URL       http://minio:9000              (local) or SeaweedFS URL
BLOGFORGE_S3_ACCESS_KEY                                        (from binding in prod)
BLOGFORGE_S3_SECRET_KEY                                        (from binding in prod)
BLOGFORGE_S3_BUCKET             blogforge                        (created on boot if missing)
BLOGFORGE_S3_REGION             us-east-1                       (placeholder for S3 SDK; ignored by SeaweedFS)
```

On Tanzu, `BLOGFORGE_DATABASE_URL`, `BLOGFORGE_S3_*` are read from `VCAP_SERVICES` automatically by a small `blogforge.config.tanzu` adapter (parses the bound service credentials and exports them as env vars before pydantic-settings reads them).

## Docker Compose

```yaml
# docker-compose.yml at repo root
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: blogforge
      POSTGRES_PASSWORD: blogforge
      POSTGRES_DB: blogforge
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "blogforge"]
      interval: 5s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: blogforge
      MINIO_ROOT_PASSWORD: blogforge-minio-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]

  api:
    build: ./packages/api
    environment:
      BLOGFORGE_DATABASE_URL: postgresql+asyncpg://blogforge:blogforge@postgres:5432/blogforge
      BLOGFORGE_S3_ENDPOINT_URL: http://minio:9000
      BLOGFORGE_S3_ACCESS_KEY: blogforge
      BLOGFORGE_S3_SECRET_KEY: blogforge-minio-secret
      BLOGFORGE_S3_BUCKET: blogforge
      BLOGFORGE_SESSION_SECRET: dev-session-secret-change-me
      BLOGFORGE_ADMIN_EMAIL: dbbaskette@gmail.com
      BLOGFORGE_ADMIN_PASSWORD: VMware0!
      BLOGFORGE_CORS_ORIGINS: http://localhost:7881
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
    ports: ["7880:7880"]

volumes:
  pgdata:
  miniodata:
```

`make dev` brings the stack up. Web (vite) still runs on host at :7881 with its own `pnpm dev`.

## Tanzu Platform deployment

### manifest.yml

```yaml
applications:
  - name: blogforge
    memory: 512M
    instances: 1
    buildpacks:
      - python_buildpack
    command: blogforge serve --host 0.0.0.0 --port $PORT
    services:
      - blogforge-postgres            # Tanzu Postgres on Demand instance
      - blogforge-s3                  # SeaweedFS service instance
    env:
      BLOGFORGE_ADMIN_EMAIL: dbbaskette@gmail.com
      # BLOGFORGE_ADMIN_PASSWORD, BLOGFORGE_SESSION_SECRET set via `cf set-env`
      # or a CredHub-backed UPS for the secret material.
      BLOGFORGE_S3_BUCKET: blogforge
      BLOGFORGE_S3_REGION: us-east-1
```

### `blogforge.config.tanzu` adapter

On import (before pydantic-settings reads env), if `VCAP_SERVICES` is set:
- Find a service tagged `postgresql` / labeled `postgres` or named `blogforge-postgres`; extract `credentials.uri`; transform to `postgresql+asyncpg://…`; set `BLOGFORGE_DATABASE_URL`.
- Find a service tagged `s3` or labeled `seaweedfs` or named `blogforge-s3`; extract `endpoint`, `access_key`, `secret_key`; set the `BLOGFORGE_S3_*` env vars.

Idempotent and silent if `VCAP_SERVICES` is absent (local dev).

### Buildpack notes

The Python buildpack picks up `packages/api/pyproject.toml`. The web bundle is pre-built into `packages/api/blogforge/web/` (existing pattern — `scripts/install-local.sh` already builds + copies). We add a `pre-push` hook (or just document the build step) so `cf push` sees the bundled web assets.

## Migration to Postgres-backed store

One commit: replace `DraftStore` (json files) with `SqlDraftStore` (Postgres). Every API route that takes `DraftStore` is updated to also take `current_user: User = Depends(get_current_user)` and pass `current_user.id` through.

Existing routes in scope for user-scoping:
- `api/drafts.py` (CRUD + list)
- `api/outline.py` (generate)
- `api/section.py` (regenerate, save)
- `api/expand.py` (bulk expand)
- `api/download.py` (markdown export)
- `api/lint.py`

Routes NOT scoped (public or admin-only by design):
- `api/auth/*`
- `api/admin/*`
- `api/packs/*` (pack list is global — myvoice provides packs at the server level)
- `api/providers/*` (same)
- `api/health`
- `api/events` (SSE — still global event bus; per-user filtering is Phase B if needed)

## Testing

### API (pytest, with `pytest-postgresql` for isolated DB-per-test)

- `test_auth_request_login.py` — request → admin approve → login → me → logout.
- `test_auth_pending_blocked.py` — pending user can't hit /api/drafts.
- `test_admin_authorization.py` — non-admin can't hit /api/admin/*.
- `test_drafts_scoped_by_user.py` — user A's drafts invisible to user B.
- `test_session_cookie_signature.py` — tampered cookie rejected.
- `test_admin_seed.py` — admin is seeded once; second boot is no-op.
- `test_password_hash.py` — argon2 verify against the seeded hash.
- `test_tanzu_config_adapter.py` — feeding a fake `VCAP_SERVICES` exports the right env vars.
- Existing draft/outline/section tests updated to set up a user and pass `user_id`.

### Web (vitest)

- `LoginPage.test.tsx` — both tabs render; submit hits the right endpoints.
- `AdminPage.test.tsx` — pending list renders; approve calls right endpoint.
- `RequireAuth.test.tsx` — unauthenticated request redirects to /login.
- Existing `DraftsPage` / `DraftPage` tests mock `useMe()` to return an approved user.

### Manual / smoke

- `docker-compose up` — log in as admin, create a draft, log out, sign up as a new user, admin approves, the new user sees an empty list, creates a draft, logs out — admin's drafts are not visible.
- `cf push` to your Tanzu sandbox foundation: same script.

## Risks

- **Lifespan + Alembic + multiple instances.** Running `alembic upgrade head` on every app start is fine for `instances: 1`. If we scale to N instances on Tanzu, all N will try to migrate; Alembic uses an advisory lock to serialise, but failures here will block boot. Mitigation: split migrate-on-boot behind an env flag (`BLOGFORGE_RUN_MIGRATIONS=true`) so only one instance does it (or run migrations via a separate `cf run-task` step in CI).

- **Asyncpg + connection pooling under Tanzu's network.** Default pool size of 10 with a 30s timeout. Mitigation: surface pool metrics in /health/db, add a connection-retry on boot in case Postgres binding propagation lags.

- **SeaweedFS S3 quirks.** Some S3 SDKs (boto3) bake in AWS-specific behaviors (region routing, path-style URLs). Mitigation: use `addressing_style="path"` in the boto3 client config, set `region_name="us-east-1"` as a placeholder, and write a smoke test against MinIO locally that we know also runs against SeaweedFS in prod. (Note: S3 isn't actually used until Phase B; this PR just provisions the client + bucket bootstrap.)

- **CORS + cross-origin cookies in dev.** Browsers can be finicky with `SameSite=None Secure=True` over plain http. Localhost is the documented exception, but if a dev runs against a non-localhost IP (e.g. their LAN), cookies won't ride. Mitigation: document in CONTRIBUTING; provide a fallback `vite proxy` config so cookies can be same-origin if needed.

- **Scope.** Phase A is large (3 tables, 11 endpoints, 4 UI routes, Docker, Tanzu manifest). Mitigation: review checkpoint after the data-layer cutover lands, before UI is wired.

## Out of scope (v1)

- Per-user provider API keys (still pulled from `~/.myvoice/config.yaml` server-side).
- Password reset / forgot-password.
- Email verification on sign-up.
- Email notifications when admin approves/rejects a request.
- Account deletion by the user themselves.
- Audit log of admin actions.
- Pack visibility per user (all packs are global for v1).
- Rate limiting on the login endpoint (relies on argon2's cost to slow brute force).
- HTTPS termination — Tanzu's GoRouter handles it; local dev is HTTP.
