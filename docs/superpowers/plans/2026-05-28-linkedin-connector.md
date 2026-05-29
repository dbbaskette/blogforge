> **ABANDONED (2026-05-28).** The LinkedIn connector was built and merged (PR #16),
> then removed: a 1,500-word draft can't fit LinkedIn's 3,000-char feed-post cap and
> the long-form Article API isn't available to third-party apps, so it wasn't worth
> carrying. Kept for history. See the removal PR.

---

# LinkedIn connector — implementation plan

**Spec:** `docs/superpowers/specs/2026-05-28-linkedin-connector-design.md`.
**Branch:** `linkedin-connector`.
**Discipline:** TDD per task — failing test → green → commit. Every commit keeps the suite green. Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

~20 tasks across 7 sections. LinkedIn is mocked via `respx` everywhere in tests; the only thing that needs a real LinkedIn Developer app is the final manual OAuth smoke (a prerequisite the operator supplies via env).

## Architecture refinement (decided here)

The connector ships as a **second app factory inside the existing `pencraft` package**, not a separate Python package — it reuses `SecretCipher`, the db engine/session, `SessionSigner`, and the ORM `Base`/`User`. "Separate container" is achieved by running the **same image with a different command** (`pencraft-linkedin serve`), which is still its own process / scaling unit / bound app. This maximizes code reuse and avoids a second wheel build. If the connector ever needs true isolation (own DB, own release cadence), extracting it to `packages/linkedin/` later is mechanical.

## Prerequisites

- A LinkedIn Developer app with the **Share on LinkedIn** + **Sign In with LinkedIn using OpenID Connect** products enabled. Operator supplies `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`. Tests don't need these (respx mocks the token + API endpoints); only Task 19's live smoke does.
- Baseline: `uv run pytest packages/api/tests -q` green (221 as of branch point).

---

## Section 1 — Connector foundation

### Task 1: LinkedIn Settings + app factory + health
**Files:** `packages/api/pencraft/linkedin/__init__.py`, `packages/api/pencraft/linkedin/config.py`, `packages/api/pencraft/linkedin/app.py`, `packages/api/pencraft/cli.py` (add `serve-linkedin`), `packages/api/tests/linkedin/test_app.py`
- `LinkedInSettings` (pydantic-settings, `LINKEDIN_`-prefixed): client_id, client_secret, redirect_uri, api_version (default current `YYYYMM`), plus reuse of `PENCRAFT_SESSION_SECRET` + `PENCRAFT_DATABASE_URL`.
- `create_linkedin_app()` → FastAPI app, mounts the linkedin router, `/linkedin/health`.
- CLI: `pencraft serve-linkedin --host --port` (uvicorn the linkedin app).
- Test: app boots, `/linkedin/health` → `{"status":"ok"}`.

### Task 2: Shared-cookie auth dependency
**Files:** `packages/api/pencraft/linkedin/auth.py`, test in `test_app.py`
- Reuse `pencraft.auth.dependencies.get_current_user` (it already validates the shared cookie + loads the user). Confirm it works mounted in the linkedin app.
- Test: a protected probe route 401s without cookie, 200 with a valid signed cookie for an approved user.

---

## Section 2 — Data model

### Task 3: ORM models + migration 0004
**Files:** `packages/api/pencraft/db/models.py` (add `LinkedInConnection`, `LinkedInPost`), `packages/api/alembic/versions/0004_linkedin.py`, `packages/api/tests/test_linkedin_models.py`
- Per spec §"Data model". `linkedin_connections.user_id` PK+FK (one per user). `linkedin_posts.draft_id` FK SET NULL.
- Migration adds both tables; verify `alembic upgrade head` on temp sqlite.
- Tests: round-trip, encrypted-token column stores ciphertext, cascade on user delete.

---

## Section 3 — OAuth

### Task 4: Signed OAuth state
**Files:** `packages/api/pencraft/linkedin/state.py`, `test_oauth_state.py`
- `sign_state(user_id) -> str` / `verify_state(token) -> UUID | None` via itsdangerous (reuse pattern from `SessionSigner`), short TTL (~10 min).
- Tests: round-trip, tamper → None, expired → None, wrong-secret → None.

### Task 5: GET /linkedin/connect
**Files:** `packages/api/pencraft/linkedin/routes.py`, `test_oauth_routes.py`
- Returns `{authorize_url}` with `scope=openid profile w_member_social`, signed `state`, configured `redirect_uri`.
- Test: URL parses, has all scopes, state verifies back to the user.

### Task 6: GET /linkedin/callback
**Files:** same routes; `test_oauth_routes.py`
- Verify state → exchange code at token endpoint (respx mock) → fetch `/v2/userinfo` (respx mock) → upsert encrypted `LinkedInConnection` → 302 back to Pencraft (`LINKEDIN_POST_CONNECT_REDIRECT`, default `/settings`).
- Tests: happy path persists connection + redirects; bad state → 400; token-exchange failure → 502 + no row.

### Task 7: status + disconnect
**Files:** same routes; `test_oauth_routes.py`
- `GET /linkedin/status` → `{connected, member_name?, expires_at?}`.
- `DELETE /linkedin/connection` → 204, row removed.
- Tests for both, plus cross-user isolation (user A can't see/delete B's connection).

---

## Section 4 — Publish + stats

### Task 8: LinkedIn API client
**Files:** `packages/api/pencraft/linkedin/client.py`, `test_linkedin_client.py`
- `LinkedInClient(access_token)` with `create_post(author_urn, commentary, visibility) -> post_urn` (POST `/rest/posts`, versioned header, URN from `x-restli-id`) and `social_actions(post_urn) -> {likes, comments}` (GET `/v2/socialActions/{urn}`).
- A typed `LinkedInError` (with a `.stale_token: bool` for 401). respx-mock both endpoints.
- Tests: post returns URN; 401 → LinkedInError(stale_token=True); socialActions parsed.

### Task 9: POST /linkedin/publish
**Files:** routes; `test_publish.py`
- Load connection (401 if not connected / stale). Validate `len(text) <= 3000` → 422 `content_too_long` with overflow count. Post via client. Persist `LinkedInPost`. Return `{post_urn}` 201.
- On LinkedInError(stale_token) → 409 `linkedin_reconnect_required`.
- Tests: happy path persists + returns URN; over-limit 422; not-connected 401; stale-token 409.

### Task 10: posts list + stats
**Files:** routes; `test_publish.py`
- `GET /linkedin/posts` → this user's `LinkedInPost[]` (newest first).
- `GET /linkedin/stats/{post_id}` → calls socialActions, caches `last_stats`/`last_stats_at` on the row, returns `{likes, comments, fetched_at}`.
- Tests: list scoping; stats fetch + cache; cross-user 404.

---

## Section 5 — Pencraft web integration

### Task 11: web API client
**Files:** `packages/web/src/api/linkedin.ts`, `tests/api/linkedin.test.ts`
- Typed wrappers over the connector endpoints, hitting `/linkedin/*` (same-origin proxy).

### Task 12: Settings page + LinkedIn card
**Files:** `packages/web/src/routes/SettingsPage.tsx` (new), `App.tsx` route + `RequireAuth`, AppShell user-menu link, `tests/routes/SettingsPage.test.tsx`
- "LinkedIn" card: not-connected → "Connect LinkedIn" (opens authorize_url); connected → "Connected as {name}" + Disconnect.
- This is also the home for a future "Account" section.

### Task 13: draft-footer Post button + posted chip
**Files:** `packages/web/src/components/draft/WorkspaceFooter.tsx`, `tests/components/WorkspaceFooter.test.tsx`
- "Post to LinkedIn" button enabled when stage=sections + connected. Live char count vs 3000; disabled-with-reason when over, with "post opening section as teaser" escape hatch.
- After posting: "Posted to LinkedIn ✓ — 👍{likes} · 💬{comments} [refresh]" via the stats endpoint.

### Task 14: vite proxy + prod routing note
**Files:** `packages/web/vite.config.ts`, README
- Dev: proxy `/linkedin` → `http://localhost:<linkedin-port>`. Document the prod same-origin path-prefix expectation.

---

## Section 6 — Container + Tanzu

### Task 15: docker-compose service
**Files:** `docker-compose.yml`
- `linkedin` service: same image as `api`, command `pencraft serve-linkedin --host 0.0.0.0 --port 7890`, env `LINKEDIN_*` + shared `PENCRAFT_SESSION_SECRET`/`PENCRAFT_DATABASE_URL`, depends_on postgres healthy. Web `api` service gets the proxy target.

### Task 16: Tanzu manifest
**Files:** `manifest.yml`
- Second application `pencraft-linkedin`, same buildpack, command `pencraft serve-linkedin`, bound to `pencraft-postgres`. Document `cf set-env` for `LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI`.

### Task 17: README + env docs
**Files:** `README.md`
- "LinkedIn integration" section: create a LinkedIn dev app, the products/scopes needed, the env vars, the 60-day reconnect reality, the char-limit + stats caveats.

---

## Section 7 — Wrap-up

### Task 18: quality sweep
- ruff, mypy strict, pytest (api + linkedin), biome, vitest, pnpm build — all clean.

### Task 19: live smoke (operator-assisted)
- With a real LinkedIn dev app + env vars: connect → publish a short test post → confirm it appears on the feed → fetch stats. Document as a manual checklist (can't be automated without real creds).

### Task 20: PR
- Push branch, open PR with the spec/plan cross-links + the manual OAuth test checklist + the platform-limit caveats spelled out.

---

## Dispatch strategy

- **Sections 1–4 (connector backend)** — inline, mostly. OAuth + token handling deserves close eyes. ~10 tasks.
- **Section 5 (web)** — dispatch to a subagent once the connector API is stable (same pattern as Phase A/B web sections).
- **Sections 6–7** — inline; small + need judgment on the live smoke.

## Watch-outs

- **Token at rest:** reuse `SecretCipher(get_settings().session_secret)` — same key the API keys use. Acceptable for MVP; note in the spec that rotating the secret invalidates both stored LinkedIn tokens and live cookies.
- **`x-restli-id` header parsing:** the post URN comes back in a response *header*, not the JSON body. Don't miss it.
- **Versioned API header:** `LinkedIn-Version: YYYYMM` is required on `/rest/*` calls; centralize it in the client so a bump is one line.
- **Char count must match LinkedIn's:** count by Unicode code points, mirror what the FE shows, to avoid "looks fine, posts rejected."
- **Don't background-poll stats** in MVP — on-demand only, or LinkedIn rate limits will bite.
