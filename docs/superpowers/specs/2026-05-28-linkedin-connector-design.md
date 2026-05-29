> **ABANDONED (2026-05-28).** The LinkedIn connector was built and merged (PR #16),
> then removed: a 1,500-word draft can't fit LinkedIn's 3,000-char feed-post cap and
> the long-form Article API isn't available to third-party apps, so it wasn't worth
> carrying. Kept for history. See the removal PR.

---

# LinkedIn connector — design

**Date:** 2026-05-28
**Status:** Draft for review
**Scope decision:** Personal profile posting (member feed). Spec-first, no code yet.

## Motivation

Pencraft drafts a piece in your voice. The last mile is publishing it. For LinkedIn-format drafts we want a one-click **Post to LinkedIn** button and a lightweight signal of how the post is doing afterward — all without leaving Pencraft.

This is built as a **separate container** (`pencraft-linkedin`) so the LinkedIn OAuth client secret and member tokens live in their own blast radius, the OAuth callback URL is stable and independent of Pencraft's release cycle, and LinkedIn's frequent API-version churn stays out of the core app.

## Reality check (read before estimating)

LinkedIn's API constrains this more than the UI suggests. The spec is honest about it:

- **Posting to a member's own feed** — supported via the *Share on LinkedIn* product + `w_member_social` scope. Self-serve. ✅
- **Feed-post length cap ~3,000 characters (~500 words).** A 1,500-word draft does **not** fit a feed post. Long-form = a LinkedIn *Article*, and the Articles publishing API is **not** available to third-party apps. So the button targets short content; longer drafts get a clear "too long for a feed post" guard with a "post the opening as a teaser" option. ⚠️
- **Member-post analytics are thin.** LinkedIn does **not** expose impressions/reach for individual member posts. The Social Actions API gives **like and comment counts** for shares the member authored — that's the ceiling for personal posts. Rich analytics require a *company page* + Marketing Developer Platform approval, which is explicitly out of scope here. ⚠️
- **Token lifetime ~60 days; refresh tokens are program-gated.** MVP treats expiry as "reconnect" rather than silent refresh. ⚠️

## Architecture

```
┌────────────┐   session cookie    ┌──────────────────────┐   HTTPS    ┌──────────┐
│  Pencraft  │ ──────────────────> │  pencraft-linkedin    │ ─────────> │ LinkedIn │
│  web + API │ <────────────────── │  (FastAPI container)  │ <───────── │   API    │
└────────────┘   JSON responses    └──────────┬───────────┘            └──────────┘
                                               │
                                        Postgres (shared)
                                   linkedin_connections / linkedin_posts
```

- **Auth sharing.** The connector validates the *same* signed Pencraft session cookie (shares `PENCRAFT_SESSION_SECRET`), so it resolves "current user" without its own login. It reuses the `SessionSigner` + a read-only `get_current_user`-style dependency. No second login.
- **DB sharing.** Same Postgres instance, two new tables owned by the connector. (Alternative considered: its own DB. Rejected for MVP — the user→connection mapping needs the same `users.id`, and a shared DB avoids cross-service joins. The connector still owns its tables.)
- **Secret isolation.** Only the connector holds `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` and the member access tokens (encrypted at rest via the existing `SecretCipher`).
- **Deploy.** Its own Tanzu app (`pencraft-linkedin`) bound to the same Postgres service; its own route. Local dev: a third service in `docker-compose.yml`.

## OAuth flow (3-legged, OpenID Connect + Share)

Scopes: `openid profile w_member_social`.

1. User clicks **Connect LinkedIn** in Pencraft → calls connector `GET /linkedin/connect`.
2. Connector returns the authorize URL with a signed `state` (CSRF + carries the user id):
   `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=…&redirect_uri=…/linkedin/callback&scope=openid%20profile%20w_member_social&state=<signed>`
3. User authorizes on LinkedIn → redirect to `GET /linkedin/callback?code=…&state=…`.
4. Connector verifies `state`, exchanges the code at `POST https://www.linkedin.com/oauth/v2/accessToken`.
5. Connector fetches member identity from `GET /v2/userinfo` (`sub` → `urn:li:person:{sub}`, plus name).
6. Persist an encrypted `linkedin_connections` row; redirect the browser back to Pencraft (`/settings` or the draft).

## Connector API

All endpoints require a valid Pencraft session cookie (resolve `user_id` from it). All per-user-scoped.

| Method | Path | Body / params | Result |
|---|---|---|---|
| GET | `/linkedin/connect` | — | `{ authorize_url }` |
| GET | `/linkedin/callback` | `code`, `state` | 302 redirect back to Pencraft |
| GET | `/linkedin/status` | — | `{ connected: bool, member_name?, expires_at? }` |
| DELETE | `/linkedin/connection` | — | 204 (deletes token row) |
| POST | `/linkedin/publish` | `{ text: str, visibility?: "PUBLIC"\|"CONNECTIONS" }` | `{ post_urn }` (201) |
| GET | `/linkedin/posts` | — | `LinkedInPost[]` (this user's posted drafts) |
| GET | `/linkedin/stats/{post_id}` | — | `{ likes, comments, fetched_at }` |

`/publish` validates `len(text) <= 3000` → 422 `content_too_long` with the overflow count, so the UI can guard before calling.

## Posting

`POST https://api.linkedin.com/rest/posts` with headers `LinkedIn-Version: <yyyymm>`, `X-Restli-Protocol-Version: 2.0.0`, `Authorization: Bearer <token>`:

```json
{
  "author": "urn:li:person:{id}",
  "commentary": "<the draft text>",
  "visibility": "PUBLIC",
  "distribution": { "feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": [] },
  "lifecycleState": "PUBLISHED"
}
```

Post URN comes back in the `x-restli-id` response header. We persist it to `linkedin_posts`.

## Stats (member ceiling: likes + comments)

`GET https://api.linkedin.com/v2/socialActions/{postUrn}` → `likesSummary.totalLikes`, `commentsSummary.totalComments`. We expose only those two numbers, cache the last fetch on the row, and the UI polls on demand (no background polling in MVP). The spec explicitly does **not** promise impressions/reach — LinkedIn doesn't give them for member posts.

## Data model (connector-owned tables)

```python
class LinkedInConnection(Base):
    __tablename__ = "linkedin_connections"
    user_id:               Mapped[UUID]  # PK + FK users.id, one connection per user
    member_urn:            Mapped[str]   # urn:li:person:{sub}
    member_name:           Mapped[str]
    encrypted_access_token: Mapped[str]  # SecretCipher
    scope:                 Mapped[str]
    expires_at:            Mapped[datetime]
    created_at / updated_at

class LinkedInPost(Base):
    __tablename__ = "linkedin_posts"
    id:               Mapped[str]   # PK
    user_id:          Mapped[UUID]  # FK users.id, index
    draft_id:         Mapped[UUID | None]  # FK drafts.id, SET NULL (post can outlive a draft)
    post_urn:         Mapped[str]
    commentary:       Mapped[str]   # snapshot of what we posted
    posted_at:        Mapped[datetime]
    last_stats:       Mapped[dict | None]  # JSON {likes, comments}
    last_stats_at:    Mapped[datetime | None]
```

Migration `0004_linkedin` adds both. (Lives in the connector's own alembic chain if it has its own metadata, or in the shared chain — TBD in plan; shared is simpler.)

## Pencraft integration (web)

- **Connect flow:** a "LinkedIn" card in a new `/settings` page (or the existing draft footer) — "Connect LinkedIn" → opens the authorize URL → on return shows "Connected as {name}".
- **Post button:** in `WorkspaceFooter` / `SectionsPanel` when the draft is complete. Shows a live char count vs 3,000. Disabled (with reason) when over the limit; offers "Post opening section as a teaser" as the escape hatch.
- **Posted state:** once posted, the draft shows "Posted to LinkedIn ✓ — 👍 {likes} · 💬 {comments} [refresh]".

## Container + Tanzu

- New `packages/linkedin/` (FastAPI app, mirrors `packages/api` patterns: Settings, SqlAlchemy, alembic, SecretCipher reuse).
- `docker-compose.yml`: add a `linkedin` service, bound to the same postgres, env `LINKEDIN_CLIENT_ID/SECRET`, `PENCRAFT_SESSION_SECRET` (shared, to validate cookies), `LINKEDIN_REDIRECT_URI`.
- `manifest.yml`: a second application `pencraft-linkedin` bound to `pencraft-postgres`.
- The web client talks to the connector via a configurable base URL (`VITE_LINKEDIN_URL`), same-origin in prod via a path prefix or a sibling route.

## Testing

- OAuth: state sign/verify round-trip; callback exchanges code (mock LinkedIn token endpoint via respx); connection persisted encrypted.
- Publish: mock `/rest/posts`; assert URN persisted; `content_too_long` 422 over 3,000 chars; 401 from LinkedIn → connection marked stale.
- Stats: mock socialActions; likes/comments parsed + cached.
- Cookie auth: connector rejects missing/invalid Pencraft session cookie (401); cross-user post access 404s.
- Web: connect-status rendering; post button char-count guard; posted-state chip.

## Out of scope (v1)

- Company-page posting + Marketing Developer Platform analytics (impressions/reach).
- LinkedIn Article (long-form) publishing — API not available to third parties.
- Scheduled posts; multi-image / document / poll posts.
- Background stats polling / historical charts.
- Silent token refresh (gated by LinkedIn program access) — MVP reconnects on expiry.
- Comment/reply management.

## Risks

- **Char-limit vs long-form mismatch** — the headline UX risk. Mitigated by the char-count guard + teaser escape hatch, and by steering the LinkedIn pack format toward ≤500-word targets.
- **Thin stats** — manage expectations; likes/comments only. Impressions need a company page + MDP.
- **Token expiry (~60 days, no refresh)** — surfaced as a "Reconnect" prompt on the next publish 401.
- **LinkedIn API version churn** — pin `LinkedIn-Version`, centralize the header, watch deprecations.
- **App review / verification** — Share on LinkedIn is largely self-serve, but the dev app may need verification before production posting; flag early.
- **Shared session secret across two containers** — rotating `PENCRAFT_SESSION_SECRET` now invalidates cookies in both; acceptable, documented.

## Resolved decisions (was: open questions)

1. **Migrations: shared chain.** `0004_linkedin` lives in `packages/api/alembic/versions/` alongside the existing chain; the API runs it on boot. The connector reuses the same `Base.metadata`. Rationale: the connector already shares the DB + session secret, so schema isolation buys little for MVP. Revisit only if the connector ever needs its own database.
2. **Web → connector: same-origin reverse-proxy** under `/linkedin/*` (no second CORS surface). In dev, the vite proxy forwards `/linkedin/*` to the connector port; in prod, the ingress/route maps the path prefix.
3. **Post UX: connect in `/settings`, publish in the draft footer.** A "LinkedIn" card in settings handles the OAuth connect/disconnect + connection status; the draft footer carries the "Post to LinkedIn" button (with char-count guard) and the posted-state chip.
