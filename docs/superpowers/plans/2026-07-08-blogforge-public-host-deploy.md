# BlogForge Public Host Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan — it mutates a live Cloudflare Tunnel, handles secrets, and drives launchd on the user's machine, so run it inline with checkpoints rather than autonomous subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve BlogForge natively on this Mac (SQLite + filesystem, `claude-cli`/subscription auth) and expose it publicly at `https://blogforge.baskettecase.com` through the Cloudflare Tunnel that already runs on this host.

**Architecture:** BlogForge runs as a launchd-supervised host process on `127.0.0.1:7880`. The existing `cloudflared` Docker container (tunnel `baskettecase`) adds one ingress rule routing `blogforge.baskettecase.com → http://host.docker.internal:7880`. No BlogForge container, no Postgres/MinIO, no inbound ports (the tunnel dials out).

**Tech Stack:** Python 3.11 (via `uv`), FastAPI/uvicorn, Vite/pnpm web bundle, macOS `launchd`, Cloudflare Tunnel (`cloudflared`), GitHub OAuth.

**Spec:** `docs/superpowers/specs/2026-07-08-blogforge-public-host-deploy-design.md`

## Global Constraints

- **Public URL:** `https://blogforge.baskettecase.com` (exact; drives the OAuth `redirect_uri`).
- **Port:** BlogForge listens on `7880`.
- **Data dir:** `/Users/dbbaskette/.blogforge` (SQLite `blogforge.db` + `blobs/`).
- **Sign-in:** GitHub OAuth only; allowlist `dbbaskette`; admin login `dbbaskette`.
- **Cookies:** `BLOGFORGE_COOKIE_SECURE=true` (HTTPS browser leg); `cookie_samesite` stays default `lax`.
- **claude-cli:** the serve process must have `claude` on `PATH` and must **scrub** `ANTHROPIC_*`/`CLAUDE_*` env so `claude -p` uses the host subscription login.
- **Tunnel:** name `baskettecase`, ID `40bb2de4-03d6-49ff-a051-bf72de8c99cd`; IaC repo `/Users/dbbaskette/Projects/home-server`; services attach via external Docker net `edge`.
- **Secrets:** `.env.public` holds the OAuth secret + session secret and is **gitignored** — never commit it.
- **Do NOT use** `scripts/install-local.sh` (requires the retired `../myvoice`). Use `uv sync`.

---

### Task 1: Confirm architecture + install host toolchain

**Files:** none (host environment only)

**Interfaces:**
- Produces: working `uv` and `pnpm` on `PATH`; a definitive answer to Apple Silicon vs Intel that later tasks reuse (the `ARCHPREFIX` convention below).

- [ ] **Step 1: Determine the real CPU (the shell reported `x86_64`, user believes M1)**

Run:
```bash
sysctl -n machdep.cpu.brand_string; echo "arm64-capable: $(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)"
```
Expected: prints the CPU model. **Set `ARCHPREFIX` once in this shell** so Tasks 1–2 install native tools on either CPU (launchd spawns native arm64, so an Apple-Silicon venv must be arm64; `arch -arm64` *errors* on Intel, hence the branch):
```bash
if sysctl -n machdep.cpu.brand_string | grep -qi apple; then export ARCHPREFIX="arch -arm64"; else export ARCHPREFIX=""; fi
echo "ARCHPREFIX='${ARCHPREFIX}'"
```
Every `${ARCHPREFIX:-}` below expands to `arch -arm64` on Apple Silicon and to nothing on Intel.

- [ ] **Step 2: Install `uv`**

Run:
```bash
${ARCHPREFIX:-} /bin/bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
```
Expected: installs to `~/.local/bin/uv`. Then confirm it's on PATH: `command -v uv || export PATH="$HOME/.local/bin:$PATH"`.

- [ ] **Step 3: Install `pnpm` via corepack (node 25 ships it)**

Run:
```bash
corepack enable pnpm
```
Expected: creates a `pnpm` shim. If `corepack` is unavailable, fall back to `npm i -g pnpm`.

- [ ] **Step 4: Verify the toolchain (the gate)**

Run:
```bash
uv --version && pnpm --version && node --version && command -v claude
```
Expected: `uv` ≥ 0.5, a `pnpm` version, node v25.x, and `/Users/dbbaskette/.local/bin/claude`. All four succeed → task done. No commit (host-only changes).

---

### Task 2: Build the web bundle + create the Python venv

**Files:**
- Build into: `packages/api/blogforge/static/` (gitignored)
- Create: `.venv/` (gitignored)

**Interfaces:**
- Consumes: `uv`, `pnpm` from Task 1.
- Produces: `.venv/bin/blogforge` entrypoint; a populated `packages/api/blogforge/static/index.html`.

- [ ] **Step 1: Build the web bundle into the API static dir**

Run from repo root `/Users/dbbaskette/Projects/blogforge` (reuse `ARCHPREFIX` from Task 1; if this is a fresh shell, re-run the Task 1 Step 1 snippet first):
```bash
APP_VERSION=$(node -p "require('./packages/web/package.json').version")
GIT_SHA=$(git rev-parse --short HEAD)
( cd packages/web && ${ARCHPREFIX:-} pnpm install --frozen-lockfile && \
  VITE_APP_VERSION="$APP_VERSION" VITE_GIT_SHA="$GIT_SHA" ${ARCHPREFIX:-} pnpm build )
rm -rf packages/api/blogforge/static && mkdir -p packages/api/blogforge/static
cp -R packages/web/dist/. packages/api/blogforge/static/
```
Expected: `pnpm build` completes; `dist/` is copied.

- [ ] **Step 2: Verify the bundle exists**

Run: `test -f packages/api/blogforge/static/index.html && echo OK`
Expected: `OK`.

- [ ] **Step 3: Create the venv + install deps (editable, Python 3.11)**

Run: `${ARCHPREFIX:-} uv sync`
Expected: uv fetches Python 3.11 if needed, creates `.venv`, installs all locked deps + editable `blogforge`. (Fallback if `uv sync` misbehaves: `${ARCHPREFIX:-} uv venv --python 3.11 && ${ARCHPREFIX:-} uv pip install -r requirements.txt && ${ARCHPREFIX:-} uv pip install --no-deps -e .`.)

- [ ] **Step 4: Verify the entrypoint (the gate)**

Run: `.venv/bin/blogforge --help`
Expected: prints the `blogforge` CLI help including the `serve` command. Task done. No commit (both outputs are gitignored).

---

### Task 3: Author `serve-public.sh`, `.env.public`, and gitignore the secret

**Files:**
- Create: `scripts/serve-public.sh`
- Create: `.env.public` (gitignored — secrets)
- Modify: `.gitignore` (add `.env.public`)

**Interfaces:**
- Consumes: `.venv/bin/blogforge` from Task 2; GitHub OAuth Client ID/Secret (owner-supplied).
- Produces: an executable `scripts/serve-public.sh` that boots the server with the right env; a `.env.public` the script sources.

- [ ] **Step 1: Add `.env.public` to `.gitignore`**

Add this line under the "Local config (user secrets)" block in `.gitignore` (which currently lists `.env` and `.env.local`):
```
.env.public
```

- [ ] **Step 2: Write `scripts/serve-public.sh`**

Create `scripts/serve-public.sh` with exactly:
```bash
#!/usr/bin/env bash
# Serve BlogForge on the host for the public deploy (blogforge.baskettecase.com).
# SQLite + fs blobs in ~/.blogforge; claude-cli provider uses the host login.
# Supervised by the launchd agent com.baskettecase.blogforge. No rebuild on
# start — build the web bundle + `uv sync` at install/update time.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.public ] && { set -a; . ./.env.public; set +a; } || { echo "❌ .env.public missing" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || { echo "❌ 'claude' not on PATH — the claude-cli provider will be unavailable" >&2; exit 1; }
echo "✓ claude CLI: $(command -v claude)"

# Scrub any inherited Claude Code session env so `claude -p` resolves the host
# subscription login rather than ANTHROPIC_BASE_URL / a session OAuth token.
while IFS= read -r v; do unset "$v"; done < <(env | grep -oE '^(ANTHROPIC|CLAUDE)_[A-Za-z0-9_]+' || true)

echo "▶ serving http://127.0.0.1:7880 (SQLite ~/.blogforge, claude-cli enabled)"
exec .venv/bin/blogforge serve --host 127.0.0.1 --port 7880 --no-browser
```
Then: `chmod +x scripts/serve-public.sh`

- [ ] **Step 3: Write `.env.public` (owner supplies the two OAuth values)**

Generate a stable session secret and create the file:
```bash
SESSION_SECRET=$(openssl rand -hex 32)
cat > .env.public <<EOF
BLOGFORGE_PUBLIC_URL=https://blogforge.baskettecase.com
BLOGFORGE_COOKIE_SECURE=true
BLOGFORGE_SESSION_SECRET=${SESSION_SECRET}
BLOGFORGE_GITHUB_CLIENT_ID=<PASTE_CLIENT_ID>
BLOGFORGE_GITHUB_CLIENT_SECRET=<PASTE_CLIENT_SECRET>
BLOGFORGE_GITHUB_ALLOWLIST=dbbaskette
BLOGFORGE_GITHUB_ADMIN_LOGIN=dbbaskette
BLOGFORGE_ADMIN_EMAIL=dbbaskette@gmail.com
BLOGFORGE_DATA_DIR=/Users/dbbaskette/.blogforge
BLOGFORGE_CORS_ORIGINS=https://blogforge.baskettecase.com
EOF
chmod 600 .env.public
```
Then replace `<PASTE_CLIENT_ID>` and `<PASTE_CLIENT_SECRET>` with the values from the new GitHub OAuth App.

- [ ] **Step 4: Verify secret is ignored + syntax is valid (the gate)**

Run:
```bash
git check-ignore .env.public && bash -n scripts/serve-public.sh && echo "OK"
```
Expected: prints `.env.public` (confirming it's ignored) then `OK` (script parses). Confirm no real secret appears in `git status`.

- [ ] **Step 5: Commit the script + gitignore (NOT the secret)**

```bash
git add scripts/serve-public.sh .gitignore
git commit -m "feat(deploy): host serve script + gitignore .env.public"
```

---

### Task 4: Foreground smoke test (health + claude auth)

**Files:** none (runtime verification)

**Interfaces:**
- Consumes: `scripts/serve-public.sh`, `.env.public` from Task 3.
- Produces: proof the server boots, serves the app, and `claude -p` is authenticated — before we hand it to launchd.

- [ ] **Step 1: Boot the server in the foreground**

Run in a dedicated terminal (leave it running): `./scripts/serve-public.sh`
Expected: prints `✓ claude CLI: …` and `▶ serving http://127.0.0.1:7880`, then uvicorn startup logs (migrations run, app ready).

- [ ] **Step 2: Health check (the primary gate)**

In another terminal, run: `curl -fsS http://127.0.0.1:7880/api/health`
Expected: HTTP 200 with a JSON body containing a `version` (and commit) field.

- [ ] **Step 3: Confirm the SPA + login page serve**

Run: `curl -fsS http://127.0.0.1:7880/ | grep -o '<title>[^<]*' | head -1`
Expected: the app's HTML title (the bundle is being served).

- [ ] **Step 4: Confirm `claude -p` subscription auth works from a scrubbed env**

Run:
```bash
env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN \
  bash -c 'printf "Reply with the single word OK." | claude -p --model haiku --output-format text'
```
Expected: prints `OK` (or similar) with no auth error. If it reports "not logged in" → run `claude /login` on the host once, then retry. This is the same probe `/api/providers/claude-cli/status` runs post-login.

- [ ] **Step 5: Stop the foreground server**

Press Ctrl-C in the serve terminal. Task done when steps 2 and 4 both passed.

---

### Task 5: Install & load the launchd LaunchAgent

**Files:**
- Create: `deploy/com.baskettecase.blogforge.plist` (versioned copy in repo)
- Install to: `~/Library/LaunchAgents/com.baskettecase.blogforge.plist` (live location)

**Interfaces:**
- Consumes: `scripts/serve-public.sh` from Task 3.
- Produces: a running, auto-restarting BlogForge service on `127.0.0.1:7880`.

- [ ] **Step 1: Ensure the data/log dir exists (launchd opens the log before the app runs)**

Run: `mkdir -p /Users/dbbaskette/.blogforge`

- [ ] **Step 2: Write `deploy/com.baskettecase.blogforge.plist`**

Create `deploy/com.baskettecase.blogforge.plist` with exactly:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.baskettecase.blogforge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>exec /Users/dbbaskette/Projects/blogforge/scripts/serve-public.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/dbbaskette/Projects/blogforge</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/dbbaskette/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/dbbaskette/.blogforge/serve.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/dbbaskette/.blogforge/serve.log</string>
</dict>
</plist>
```

- [ ] **Step 3: Install and bootstrap the agent**

Run:
```bash
cp deploy/com.baskettecase.blogforge.plist ~/Library/LaunchAgents/com.baskettecase.blogforge.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.baskettecase.blogforge.plist
```
Expected: no error. (If it says "service already loaded", run `launchctl bootout gui/$(id -u)/com.baskettecase.blogforge` first, then re-bootstrap.)

- [ ] **Step 4: Verify it's running (the gate)**

Run (allow ~5s for boot):
```bash
launchctl print gui/$(id -u)/com.baskettecase.blogforge | grep -E 'state|pid' | head
curl -fsS http://127.0.0.1:7880/api/health && echo " ← agent-served"
```
Expected: state `running` with a pid, and the health check returns 200.

- [ ] **Step 5: Prove KeepAlive restarts it**

Run:
```bash
launchctl kickstart -k gui/$(id -u)/com.baskettecase.blogforge
sleep 6 && curl -fsS http://127.0.0.1:7880/api/health && echo " ← survived restart"
```
Expected: health 200 again after the forced restart.

- [ ] **Step 6: Sleep advisory check (laptop)**

Run: `pmset -g | grep -Ei 'sleep|SleepDisabled'`
Expected: review output. Because this is a plugged-in laptop, if it may sleep on lid-close the tunnel goes dark. It already runs 24/7 (containers show 12-day uptime), so likely fine. If sleep is a concern, the fix (needs sudo, optional): `sudo pmset -c disablesleep 1` for clamshell, or keep the lid open / use Amphetamine. Advisory only — no change required to pass.

- [ ] **Step 7: Commit the plist**

```bash
git add deploy/com.baskettecase.blogforge.plist
git commit -m "feat(deploy): launchd LaunchAgent for the BlogForge host service"
```

---

### Task 6: Wire the tunnel — host probe, ingress rule, DNS route

**Files (in `/Users/dbbaskette/Projects/home-server`):**
- Modify: `docker-compose.yml` (add `extra_hosts` to the `cloudflared` service)
- Modify: `config/cloudflared/config.yml` (add the `blogforge` ingress rule)

**Interfaces:**
- Consumes: the running host service on `127.0.0.1:7880` (Task 5); the `baskettecase` tunnel + `~/.cloudflared/cert.pem` (already present).
- Produces: `blogforge.baskettecase.com` routed through the tunnel to the host.

- [ ] **Step 1: Probe host reachability from the cloudflared container (the critical gate)**

Run:
```bash
docker exec cloudflared sh -c 'wget -qO- http://host.docker.internal:7880/api/health' && echo " ← reachable"
```
Expected: the health JSON. **If it fails** (Docker Desktop won't NAT `host.docker.internal` to host loopback): edit `scripts/serve-public.sh` to bind `--host 0.0.0.0`, `launchctl kickstart -k gui/$(id -u)/com.baskettecase.blogforge`, re-run this probe. The app has its own GitHub auth, so LAN exposure is low-risk. Do not proceed until this returns the JSON.

- [ ] **Step 2: Add `extra_hosts` to the cloudflared service**

In `home-server/docker-compose.yml`, add to the `cloudflared` service (alongside `networks:`):
```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```
(Auto-present on Docker Desktop; explicit for portability/reload safety.)

- [ ] **Step 3: Add the ingress rule ABOVE the 404 catch-all**

In `home-server/config/cloudflared/config.yml`, insert before the `- service: http_status:404` line:
```yaml
  # BlogForge — native host process, fronted via the Docker host gateway.
  - hostname: blogforge.baskettecase.com
    service: http://host.docker.internal:7880
```

- [ ] **Step 4: Create the DNS record for the subdomain**

Run: `cloudflared tunnel route dns baskettecase blogforge.baskettecase.com`
Expected: reports the CNAME `blogforge.baskettecase.com → 40bb2de4-…cfargotunnel.com` created (or "already exists"). Verify: `dig +short blogforge.baskettecase.com` resolves (to Cloudflare-proxied IPs).

- [ ] **Step 5: Reload the tunnel with the new config**

Run (from `/Users/dbbaskette/Projects/home-server`):
```bash
docker compose up -d   # applies extra_hosts + restarts cloudflared with the new config
docker logs --since 30s cloudflared 2>&1 | grep -Ei 'blogforge|error|config' | head
```
Expected: logs show the config loaded including `blogforge.baskettecase.com`, no errors. (If `extra_hosts` was already present, `docker restart cloudflared` suffices.)

- [ ] **Step 6: Gate — edge reachability**

Run: `curl -fsS https://blogforge.baskettecase.com/api/health`
Expected: HTTP 200 JSON, served end-to-end through Cloudflare. Task done.

---

### Task 7: End-to-end verification + commit home-server

**Files (in `/Users/dbbaskette/Projects/home-server`):** commit the Task 6 edits.

**Interfaces:**
- Consumes: the fully wired path from Tasks 1–6.

- [ ] **Step 1: Browser end-to-end — page + TLS**

Open `https://blogforge.baskettecase.com` in a browser.
Expected: the BlogForge login page loads over a valid Cloudflare TLS cert (padlock, no warning).

- [ ] **Step 2: GitHub sign-in round-trip**

Click sign in with GitHub. Expected: redirect to GitHub → authorize → callback to `https://blogforge.baskettecase.com/api/auth/github/callback` → returned signed in as `dbbaskette` (admin). If you get `redirect_uri mismatch`, the OAuth App callback doesn't exactly equal `https://blogforge.baskettecase.com/api/auth/github/callback` — fix it in the GitHub App settings.

- [ ] **Step 3: claude-cli generation (the product gate)**

Signed in, go to Settings → confirm the **Claude CLI** card shows installed + authenticated (this hits `/api/providers/claude-cli/status`). Create a draft, pick the **claude-cli** provider, and generate a section.
Expected: generation succeeds using `claude -p`. First run may pop a one-time macOS Keychain "Always Allow" prompt — grant it, then retry. Confirm no em dashes / banished words slipped through (the voice-rule enforcement).

- [ ] **Step 4: Commit the home-server changes**

```bash
cd /Users/dbbaskette/Projects/home-server
git add docker-compose.yml config/cloudflared/config.yml
git commit -m "feat(tunnel): route blogforge.baskettecase.com to host BlogForge"
```
Expected: committed. (`config/cloudflared/*.json` stays gitignored — credentials are never committed.)

- [ ] **Step 5: Final rollback note (reference, do not run)**

Documented for later: remove the ingress rule + `docker restart cloudflared` to take the site down at the edge; `launchctl bootout gui/$(id -u)/com.baskettecase.blogforge` to stop the host process. `~/.blogforge` data is untouched by either.

---

## Verification Summary (all gates)

| Task | Gate |
|---|---|
| 1 | `uv`, `pnpm`, `node`, `claude` all resolve |
| 2 | `.venv/bin/blogforge --help` runs; `static/index.html` exists |
| 3 | `git check-ignore .env.public` matches; `bash -n serve-public.sh` OK |
| 4 | `curl 127.0.0.1:7880/api/health` = 200; `claude -p` prints OK |
| 5 | launchd `state: running`; health 200 after `kickstart -k` |
| 6 | `docker exec cloudflared wget host.docker.internal:7880/api/health` = JSON; `curl https://blogforge.baskettecase.com/api/health` = 200 |
| 7 | Browser sign-in as `dbbaskette`; a section generates via claude-cli |

## Update path (future)
`git pull` → rebuild bundle + `uv sync` (Task 2 steps) → `launchctl kickstart -k gui/$(id -u)/com.baskettecase.blogforge`. No tunnel/DNS changes needed.
