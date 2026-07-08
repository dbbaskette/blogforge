# BlogForge — public deploy at blogforge.baskettecase.com (native host + existing tunnel)

**Date:** 2026-07-08
**Status:** Approved design → ready for implementation plan
**Goal:** Make BlogForge publicly reachable at `https://blogforge.baskettecase.com`, running natively on this Mac (not in a container) so it can shell out to the logged-in `claude` CLI (`claude-cli` provider, Claude subscription auth — no API keys), fronted by the Cloudflare Tunnel that already runs on this host.

---

## 1. Context (discovered)

- **App:** BlogForge is a FastAPI app (`blogforge serve`) with a Vite web bundle baked into `packages/api/blogforge/static`. Single-user friendly: SQLite at `~/.blogforge/blogforge.db` + filesystem blobs under `~/.blogforge/blobs` (the `fs` storage backend, default). Listens on port **7880**.
- **Sign-in is GitHub OAuth ONLY.** There is no password login route (`api/auth.py` exposes only `/logout`, `/me`, `/sessions/revoke-all`). The `admin_email`/`admin_password` settings only seed/link the admin account; the interactive path is `/api/auth/github/login` → `/api/auth/github/callback`. Access is gated by `BLOGFORGE_GITHUB_ALLOWLIST` (non-allowlisted logins get 403).
- **OAuth callback URL is derived from `BLOGFORGE_PUBLIC_URL`** (`api/auth_github.py::_base_url`), falling back to the request base URL. Behind the tunnel the container/host process only sees plain HTTP internally, so `BLOGFORGE_PUBLIC_URL` **must** be set to the `https://` public URL or the `redirect_uri` comes out as `http://`. Session + state cookies use `secure=BLOGFORGE_COOKIE_SECURE`, so that must be `true` for the HTTPS browser leg.
- **`claude-cli` provider** (`llm/claude_cli.py`) shells out to `claude -p --output-format json …` using the host's **subscription auth** (macOS Keychain). Its own docstring: *"Requires the API process to run where `claude` is on PATH and authenticated (i.e. on the host, not the slim container)."* `supports_streaming: false`, web search on.
- **myvoice is fully absorbed** — not a dependency, not in `uv.lock`, not imported (only a stale comment + the retired `install-local.sh` reference it). The Docker build installs standalone from `pyproject`/`uv.lock`, so a host `uv sync` works without the sibling repo. **Do not use `install-local.sh`** (it demands `../myvoice`).
- **This Mac is already the tunnel host.** A `cloudflared` container (public IP 24.131.53.238 matches this host) runs the `baskettecase` tunnel as infrastructure-as-code in `/Users/dbbaskette/Projects/home-server`:
  - Config: `config/cloudflared/config.yml` maps `hostname → http://<container>:<port>`; services attach to the external Docker network **`edge`**.
  - Existing routes: `baskettecase.com → baskettecase-com:80`, `tesla.baskettecase.com → tesla-api:8080`, catch-all `→ 404`.
  - Credentials file `40bb2de4-03d6-49ff-a051-bf72de8c99cd.json` + `~/.cloudflared/cert.pem` present (tunnel `baskettecase`, ID `40bb2de4-03d6-49ff-a051-bf72de8c99cd`).
- **Host toolchain:** `node` v25.9.0 ✅, `claude` v2.1.112 at `~/.local/bin/claude` ✅ (authenticated). **`uv` and `pnpm` are MISSING** and must be installed. System `python3` is 3.9; app needs 3.11 → `uv` provides it.

## 2. Decisions

| Decision | Choice |
|---|---|
| Run mode | **Native on host** (not a container) — required for `claude -p` subscription auth |
| Data | SQLite + filesystem blobs in `~/.blogforge` (no Postgres/MinIO) |
| Public exposure | **Existing** `baskettecase` Cloudflare Tunnel; new ingress rule → `host.docker.internal:7880` |
| Sign-in | GitHub OAuth, **reuse existing OAuth App** (update its callback URL), allowlist = `dbbaskette` |
| Extra gating | **None** — allowlist only (no Cloudflare Access) |
| Config home | The **blogforge repo** (`.env.public` + `scripts/serve-public.sh` + LaunchAgent plist), plus a 1-line ingress addition to the home-server repo |
| Process supervision | macOS **launchd LaunchAgent** (`RunAtLoad` + `KeepAlive`) — the host equivalent of `restart: unless-stopped` |

## 3. Architecture

```
Browser ──HTTPS──▶ Cloudflare edge ──tunnel──▶ cloudflared container (edge net)
                                                    │  service: http://host.docker.internal:7880
                                                    ▼
                                    BlogForge host process  (127.0.0.1:7880)
                                    · uvicorn/FastAPI, web bundle baked in
                                    · SQLite + fs blobs in ~/.blogforge
                                    · claude-cli provider → `claude -p` (subscription)
                                    · supervised by launchd LaunchAgent
```
The only container involved is the pre-existing `cloudflared`. No BlogForge container. The tunnel dials **out** to Cloudflare — no inbound ports are opened on the host or router.

## 4. Components & changes

### 4.1 Host toolchain (one-time)
- Install `uv`: `curl -LsSf https://astral.sh/uv/install.sh | sh` (lands in `~/.local/bin`).
- Install `pnpm`: `corepack enable pnpm` (node 25 ships corepack) or `npm i -g pnpm`.

### 4.2 Build + venv
- Build web bundle into the API static dir (mirrors `serve-local.sh`), stamping version/sha:
  ```bash
  APP_VERSION=$(node -p "require('./packages/web/package.json').version")
  GIT_SHA=$(git rev-parse --short HEAD)
  ( cd packages/web && VITE_APP_VERSION=$APP_VERSION VITE_GIT_SHA=$GIT_SHA pnpm build )
  rm -rf packages/api/blogforge/static && mkdir -p packages/api/blogforge/static
  cp -R packages/web/dist/. packages/api/blogforge/static/
  ```
- Create the venv + install deps (editable, so alembic migrations resolve):
  ```bash
  uv sync            # creates ./.venv with Python 3.11 + all deps + editable blogforge
  ```
  (Verify `.venv/bin/blogforge` exists afterward.)

### 4.3 `.env.public` (new, gitignored)
Secrets + public config, loaded by the serve script:
```bash
BLOGFORGE_PUBLIC_URL=https://blogforge.baskettecase.com
BLOGFORGE_COOKIE_SECURE=true
BLOGFORGE_SESSION_SECRET=<stable-random-32+ chars>
BLOGFORGE_GITHUB_CLIENT_ID=<from reused OAuth app>
BLOGFORGE_GITHUB_CLIENT_SECRET=<from reused OAuth app>
BLOGFORGE_GITHUB_ALLOWLIST=dbbaskette
BLOGFORGE_GITHUB_ADMIN_LOGIN=dbbaskette
BLOGFORGE_ADMIN_EMAIL=dbbaskette@gmail.com
BLOGFORGE_DATA_DIR=/Users/dbbaskette/.blogforge
BLOGFORGE_CORS_ORIGINS=https://blogforge.baskettecase.com
```
Add `.env.public` to `.gitignore` (currently only `.env`/`.env.local` are ignored).

### 4.4 `scripts/serve-public.sh` (new)
Production host-serve wrapper — **no rebuild on start** (build happens at install/update):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.public ] && { set -a; . ./.env.public; set +a; } || { echo "❌ .env.public missing" >&2; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "❌ 'claude' not on PATH — claude-cli unavailable" >&2; exit 1; }
# Scrub Claude Code session env so `claude -p` uses the host subscription login,
# not an inherited session token / ANTHROPIC_BASE_URL.
while IFS= read -r v; do unset "$v"; done < <(env | grep -oE '^(ANTHROPIC|CLAUDE)_[A-Za-z0-9_]+' || true)
exec .venv/bin/blogforge serve --host 127.0.0.1 --port 7880 --no-browser
```

### 4.5 LaunchAgent (new)
- Keep a **versioned copy in the repo** at `deploy/com.baskettecase.blogforge.plist`; install it by copying to `~/Library/LaunchAgents/com.baskettecase.blogforge.plist` (the live location launchd reads).
- `ProgramArguments`: `/bin/bash -lc '/Users/dbbaskette/Projects/blogforge/scripts/serve-public.sh'`
- `RunAtLoad` = true, `KeepAlive` = true.
- `WorkingDirectory` = `/Users/dbbaskette/Projects/blogforge`.
- `EnvironmentVariables.PATH` includes `/Users/dbbaskette/.local/bin:/usr/local/bin:/usr/bin:/bin` (so `claude`, `node`, `uv` resolve).
- `StandardOutPath`/`StandardErrorPath` = `/Users/dbbaskette/.blogforge/serve.log`.
- Load: `launchctl load -w ~/Library/LaunchAgents/com.baskettecase.blogforge.plist`.
- Runs in the **user login session** (LaunchAgent, not a system LaunchDaemon) so it can reach the Keychain for claude auth.

### 4.6 home-server ingress + DNS (in `/Users/dbbaskette/Projects/home-server`)
- Add to `config/cloudflared/config.yml`, **above** the `http_status:404` catch-all:
  ```yaml
    # BlogForge — native host process, fronted via the Docker host gateway.
    - hostname: blogforge.baskettecase.com
      service: http://host.docker.internal:7880
  ```
- Add to the `cloudflared` service in `home-server/docker-compose.yml` (belt-and-suspenders; auto on Docker Desktop, required on Docker Engine):
  ```yaml
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ```
- Create the DNS record (uses `~/.cloudflared/cert.pem`):
  ```bash
  cloudflared tunnel route dns baskettecase blogforge.baskettecase.com
  ```
- Reload the tunnel: `docker restart cloudflared` (or `docker compose up -d` in home-server if `extra_hosts` was added).
- Commit the `config.yml` (+ compose) change in the home-server repo.

## 5. Manual prerequisite (owner action)

Update the **reused GitHub OAuth App**:
- **Authorization callback URL** → `https://blogforge.baskettecase.com/api/auth/github/callback`
- Provide **Client ID** + **Client Secret** for `.env.public`.
- ⚠️ A GitHub OAuth App allows a single callback URL. If this app is the localhost dev app, switching it breaks local GitHub login — registering a **separate** app for the public deploy is cleaner (per `docs/github-oauth-setup.md` §1, which explicitly supports one app per environment). Owner's call.

## 6. Rollout order (with verification gates)

1. Install `uv` + `pnpm`. **Gate:** `uv --version && pnpm --version` succeed.
2. Build web bundle + `uv sync`. **Gate:** `.venv/bin/blogforge --help` runs; `packages/api/blogforge/static/index.html` exists.
3. Write `.env.public` (owner supplies OAuth creds) + gitignore it.
4. Foreground smoke test: `./scripts/serve-public.sh` in a terminal. **Gate:** `curl -fsS http://127.0.0.1:7880/api/health` returns 200; the login page loads. Ctrl-C after.
5. Install + load the LaunchAgent. **Gate:** `launchctl list | grep blogforge` shows it running; `curl /api/health` still 200 after a `launchctl kickstart -k` (proves KeepAlive restart).
6. Probe host reachability from the tunnel: `docker exec cloudflared sh -c 'wget -qO- http://host.docker.internal:7880/api/health'`. **Gate:** returns the health JSON. *If it fails* (Docker Desktop won't NAT to loopback): change `serve-public.sh` to `--host 0.0.0.0` and re-test (app has its own auth, LAN exposure low-risk).
7. `cloudflared tunnel route dns baskettecase blogforge.baskettecase.com`. **Gate:** command reports the CNAME created; `dig +short blogforge.baskettecase.com` resolves to a `*.cfargotunnel.com` / Cloudflare IP.
8. Add ingress rule (+ `extra_hosts`) and `docker restart cloudflared`. **Gate:** `docker logs cloudflared` shows the config loaded with the new hostname and no errors.
9. End-to-end: open `https://blogforge.baskettecase.com`. **Gate:** page loads over Cloudflare TLS; **GitHub sign-in completes** (redirect → callback → signed in as `dbbaskette`); creating a draft and generating a section via the **claude-cli** provider succeeds (may trigger a one-time Keychain "Always Allow" prompt on first `claude -p`).
10. Commit: blogforge repo (`scripts/serve-public.sh`, LaunchAgent plist copy under `deploy/`, `.gitignore`, this spec) and home-server repo (`config.yml`, compose). Never commit `.env.public`.

## 7. Rollback
- Remove the ingress rule + `docker restart cloudflared` → site returns 404 at the edge.
- `launchctl unload -w ~/Library/LaunchAgents/com.baskettecase.blogforge.plist` → stop the host process.
- Optionally delete the DNS record in the Cloudflare dashboard.
- Data (`~/.blogforge`) is untouched by any of the above.

## 8. Update path (future)
`git pull` → rebuild bundle + `uv sync` → `launchctl kickstart -k gui/$(id -u)/com.baskettecase.blogforge` (restart the agent). No tunnel/DNS changes needed.

## 9. Notes / risks
- **Mac must stay logged in.** A LaunchAgent only runs in the user's GUI login session (needed for Keychain/claude auth). The box already runs 24/7 (12-day container uptime), so this holds; a reboot requires logging back in for the agent to resume.
- **First `claude -p` from the agent** may prompt once for Keychain access — grant "Always Allow."
- **cookie_samesite** stays `lax` (default) — correct for the top-level OAuth redirect; do not change.
- No secrets in git: `.env.public` is gitignored; OAuth secret + session secret live only there.

## 10. Out of scope (YAGNI)
No Postgres/MinIO, no BlogForge container, no Cloudflare Access, no CI/CD, no multi-user provisioning beyond the allowlist.
