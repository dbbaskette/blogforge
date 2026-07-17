<div align="center">

# ✍️ BlogForge

**A workshop for long-form writing — that sounds like *you*, not a language model.**

Give it a topic and your voice. It researches, outlines, and writes a full 1,000–3,000 word draft
in a single coherent pass — then hands you a real editor, a proofreader that hunts AI tells, and a
one-click path from rough idea to publish-ready post.

Local-first · multi-user · bring-your-own model · runs on Docker or Tanzu Platform.

</div>

---

## ✨ The cool stuff

BlogForge is voice-first and allergic to robot-writing. These are the features that make it feel like magic:

| | Feature | What it does |
|---|---|---|
| 🔬 | **Voice Fingerprint** | A shareable "voiceprint" of *your* writing — a radar of tonal dimensions (casual · vivid · punchy · warm · concrete · direct, LLM-scored from your samples) plus your signature phrases, sentence-rhythm sparkline, and banished words. Your voice, made visible. |
| 🎤 | **Audition your voice** | Paste any flat sentence and watch it get rewritten in your voice, instantly. Proof the voice works before you write a word. |
| 🚫 | **AI-tell enforcement** | Em dashes, `--`, and banished words are *guaranteed* gone: after generation we deterministically detect violations, feed the text back to the model to recast (keeping your meaning + voice), and apply a deterministic backstop if it still slips. Not a suggestion in a prompt — an enforced rule. |
| 💯 | **Humanity Score** | The Proofreader shows a live 0–100 ring (coral → amber → green) that climbs as you clean AI tells — with a "reads human" flourish and confetti at 100. |
| 🎬 | **Generation theater** | Watch your draft get written: the outline lights up section-by-section, cards glow while composing and pop when they land, and a live word-count ticker climbs. "Writing in your voice…" |
| 📰 | **Publish-ready preview** | One tap flips the editor into a gorgeous typeset article — hero image, title, reading time, real blog typography. See the finished piece, not the workbench. |
| 🧵 | **Repurpose → every channel** | "✨ Atomize all" turns a finished post into an X thread, LinkedIn post, newsletter, TL;DR, and SEO meta — rendered as realistic platform-styled preview cards you copy with one tap. |
| ⌘ | **⌘K command palette** | Jump to anything — new draft, any existing draft, Your Voice, Settings — from anywhere. |
| 🕰️ | **Section time-travel** | Every regenerate/edit snapshots a version; a per-section **diff** shows exactly what changed (adds green, deletes struck red) before you revert. |
| 🖼️ | **AI hero images** | Generate a banner with Google Imagen, inlined into the HTML export and the Markdown frontmatter. |

…on top of the fundamentals below.

---

## Why

Most AI writing tools give you a wall of generic prose with a dozen em dashes and a "delve" in
every paragraph. BlogForge is built around the opposite premise: it starts from *your* voice (a
distilled style + your own writing samples), writes the whole post as one coherent argument, then
mechanically scrubs the tells the model leaves behind. The goal is a draft a human would actually
publish under their own name.

It builds on [myvoice](https://github.com/dbbaskette/myvoice) — a portable style pack + lint loop —
absorbed directly into BlogForge for pack loading, AI-tell detection, and prompt composition.

## How it works

Three stages per draft:

1. **Research** — paste URLs, files, or notes as references; chat with the model about your topic
   until the proposed outline feels right. References stay attached and inform every regeneration.
2. **Outline** — edit the opening hook + section titles/briefs, reorder, or regenerate. The outline
   is planned as a single non-overlapping arc, section count right-sized to your target length (≈3–7).
3. **Sections** — BlogForge composes the **entire post in a single pass** from the outline, then
   splits it back onto the sections so you can edit or regenerate any one. Writing the whole piece
   at once is what keeps it coherent and non-repetitive. Edit by hand, regenerate a section, revise
   the whole draft against one instruction, then export.

Edits **autosave** as you type (with a "Saving…/✓ Saved" indicator and version history), so a
regenerate or refetch can never wipe your work. Drafts — with their references and chat history —
persist to Postgres + S3, multi-user, scoped per account.

## Core features

- **Single-pass, coherent generation** — the post is written start-to-finish in one call, so
  sections build on each other instead of restating the thesis.
- **Inline AI editing** — select any text in the editor and rephrase / shorten / expand / fix / ask,
  in your voice. (Edits autosave and respect your voice rules.)
- **Proofreader** — style-rule lint + a repetition check (duplicate paragraphs, recycled phrases,
  echoed openers) + the live Humanity Score, with one-click AI fixes.
- **Fact-check** — checks the draft's factual claims against your attached references
  (supported / unsupported / contradicted).
- **Headline & hook lab** — generate and apply alternative titles or opening hooks.
- **Export** — Markdown, Markdown + YAML frontmatter, standalone HTML (hero image inlined), or
  Word (`.docx`).
- **Direct GitHub publishing** — each user can commit a finished post directly to one configured
  public or private content repository, with a stable path for safe republishing. Generated hero
  graphics are saved beside the post and referenced with a portable relative path.

## Your voice

Your Voice is where BlogForge learns to sound like you:

- **Persona** — identity, one-liner, tone.
- **Writing samples** — paste text, fetch a URL, or upload a file; star your strongest as
  **exemplars** (weighted most heavily). Or **import from LinkedIn** (upload your data export) to
  bootstrap a persona + samples in one shot.
- **Distill** — an LLM pass over your samples that produces a reusable style guide.
- **Rules** — banished words/phrases, no em dashes, no `--` — enforced at generation time.
- **Voice Fingerprint** + **Audition** (see ✨ above), and a portable **voice guide** Markdown export
  you can paste into any other LLM.

## Providers & models

Pick a provider per draft:

- **Anthropic / OpenAI / Google** — API-key providers. Each user adds their own keys in
  **Settings → Provider API keys** (encrypted at rest). Per-draft cost estimates from a static rate card.
- **Tanzu** — on a Tanzu Platform deploy, a bound GenAI model is offered as the **Tanzu** provider
  with **no key required** (the binding supplies the base URL + credentials).
- **Claude CLI (subscription)** — generate through your locally logged-in
  [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI (`claude -p`) instead of an API key,
  with web search on. Requires running the API on the host where `claude` is installed — see below.
- **Codex CLI (subscription)** — generate through your locally logged-in
  [Codex CLI](https://developers.openai.com/codex/cli/) (`codex exec`) instead of an API key, with
  web search and fetch available. Requires running the API on the host where `codex` is installed.

## Publish to GitHub

GitHub publishing is configured separately for each BlogForge user. It does not reuse the
read-only GitHub OAuth sign-in token, and publishing tokens do not belong in `.env` files.

1. In GitHub, create a **fine-grained personal access token**. Limit repository access to the
   content repository you want BlogForge to publish into and grant **Contents: Read and write**.
2. In **BlogForge → Settings → Publish to GitHub**, enter the repository owner, repository name,
   branch, content folder, and frontmatter preset (Hugo, Jekyll, or plain Markdown).
3. Paste the token and click **Save and test**. BlogForge verifies the authenticated GitHub login,
   private-repository access, branch, and write permission before reporting ready. The token is
   encrypted at rest, scoped to your BlogForge user, and is never returned to the browser again.
4. Open a finished draft and click **Publish to GitHub**. BlogForge commits directly to the branch
   and returns links to the file and commit. If the draft has a generated hero graphic, BlogForge
   saves the PNG beside the post and commits both files atomically.

The first publish fixes the draft's repository path. Later publishes update that same file with its
last confirmed GitHub SHA, even if the draft title changes. Hero graphics keep the same stable
sidecar path. BlogForge will not overwrite an unrelated post or image at the first-publish paths,
and it stops with a conflict if either published file changed in GitHub since the last BlogForge
commit. Resolve the repository copy deliberately, then retry.

## Quickstart (Docker)

Sign-in is **GitHub OAuth only** — there's no email/password. Register a GitHub OAuth App and set
five env vars before first start.

1. Register a GitHub OAuth App (callback `http://localhost:7880/api/auth/github/callback`) and copy
   the Client ID + secret — full steps in [`docs/github-oauth-setup.md`](docs/github-oauth-setup.md).
2. Put the config in a `.env` file Docker Compose will load:

   ```bash
   BLOGFORGE_GITHUB_CLIENT_ID=<client-id>
   BLOGFORGE_GITHUB_CLIENT_SECRET=<client-secret>
   BLOGFORGE_GITHUB_ALLOWLIST=your-github-login    # comma-separated logins allowed to sign in
   BLOGFORGE_GITHUB_ADMIN_LOGIN=your-github-login   # which login becomes the admin
   BLOGFORGE_PUBLIC_URL=http://localhost:7880       # base URL used to build the OAuth callback
   ```

3. Start it:

   ```bash
   docker compose up --build
   ```

Open http://localhost:7880. On first start the API runs migrations (`alembic upgrade head`); then
click **Sign in with GitHub**.

- Only logins in `BLOGFORGE_GITHUB_ALLOWLIST` may sign in. The `BLOGFORGE_GITHUB_ADMIN_LOGIN` becomes
  the admin on first sign-in.
- To add users: add their GitHub login to the allowlist (or let them hit `/login`, which files a
  pending request), then approve + manage roles under `/admin`.
- Each user adds their own provider keys in **Settings → Provider API keys**.

## Simplest local run (no containers)

The defaults are zero-infra: the database is a file-SQLite at `~/.blogforge/blogforge.db` and blobs
are written under `~/.blogforge/blobs/` — no Postgres or MinIO container. Just run the app on your
host (you still register a GitHub OAuth App, since sign-in is GitHub-only):

```bash
BLOGFORGE_GITHUB_CLIENT_ID=<client-id> \
BLOGFORGE_GITHUB_CLIENT_SECRET=<client-secret> \
BLOGFORGE_GITHUB_ALLOWLIST=your-github-login \
BLOGFORGE_GITHUB_ADMIN_LOGIN=your-github-login \
BLOGFORGE_PUBLIC_URL=http://localhost:7880 \
  uv run blogforge serve --port 7880
```

Everything lives under `data_dir` (`BLOGFORGE_DATA_DIR`, default `~/.blogforge`). Pair it with the
Claude CLI or Codex CLI below and you need no API keys either.

Prefer Docker? **One container** is enough now — [`docker-compose.local.yml`](docker-compose.local.yml)
runs just the app (file-SQLite + fs blobs on a mounted volume, no Postgres/MinIO):

```bash
docker compose -f docker-compose.local.yml up --build   # put GitHub OAuth creds in .env
```

The full multi-container Docker path (Postgres + MinIO) below stays available for a production-like setup.

## Using the Claude CLI or Codex CLI (subscription, no API key)

The `claude` and `codex` binaries aren't in the slim container, so run the API on your host (where
the CLI you want is installed and logged in) while Postgres/MinIO stay in Docker:

```bash
./scripts/serve-host.sh
```

This stops the containerized API, builds the web bundle into the API's static dir, and serves on
http://localhost:7880. Confirm Claude is authenticated first (`claude auth status`). Run `codex login status` as the same host account that runs BlogForge.
Then pick the matching CLI provider on a draft.

BlogForge invokes `codex exec` ephemerally and uses the model configured as the Codex CLI default.
Codex CLI generation can search and fetch the web.

## Home services production

The production instance at `https://blogforge.baskettecase.com` deploys only reviewed commits from
`origin/main` over the dedicated `blogforge-home` SSH connection:

```bash
git checkout main
git pull --ff-only
scripts/deploy-home.sh
```

See [`docs/home-services-deploy.md`](docs/home-services-deploy.md) for SSH bootstrap, preflight
rules, status and log commands, failure recovery, and explicit rollback.

## Local dev (without Docker)

Run Postgres + MinIO in Docker, API/web from your host. The host-mapped Postgres port is **5433**
(avoids colliding with a system Postgres on 5432):

```bash
docker compose up postgres minio -d
BLOGFORGE_DATABASE_URL="postgresql+asyncpg://blogforge:blogforge@localhost:5433/blogforge" \
BLOGFORGE_S3_ENDPOINT_URL="http://localhost:9000" \
BLOGFORGE_S3_ACCESS_KEY=blogforge \
BLOGFORGE_S3_SECRET_KEY=blogforge-minio-secret \
BLOGFORGE_S3_BUCKET=blogforge \
BLOGFORGE_GITHUB_CLIENT_ID=<client-id> \
BLOGFORGE_GITHUB_CLIENT_SECRET=<client-secret> \
BLOGFORGE_GITHUB_ALLOWLIST=your-github-login \
BLOGFORGE_GITHUB_ADMIN_LOGIN=your-github-login \
BLOGFORGE_PUBLIC_URL=http://localhost:7880 \
BLOGFORGE_CORS_ORIGINS=http://localhost:7881 \
  uv run blogforge serve --port 7880
```

(`./scripts/serve-host.sh` and `./scripts/run-local.sh` default the allowlist/admin/public-URL for
you.) Then the web dev server:

```bash
cd packages/web && pnpm dev    # vite :7881, API on :7880 via CORS with credentials
```

## Tanzu Platform deployment

Pure `cf push` with the `python_buildpack` — no Docker. Full guide in [`docs/cf-deploy.md`](docs/cf-deploy.md).

```bash
# 1. Bind the three services the manifest expects (check `cf marketplace` for
#    the Block Storage offering + plan names on your foundation):
cf create-service postgres on-demand-postgres-small blogforge-postgres
cf create-service <block-storage-service> <plan> blogforge-blobs   # persistent volume -> fs blob store
cf create-service ai-models tanzu-all-models blogforge-ai   # bound GenAI model -> keyless "Tanzu" provider

# 2. Register a GitHub OAuth App (callback https://<route>/api/auth/github/callback),
#    then fill in the gitignored secrets file (NEVER commit it):
cp vars.example.yml vars.yml
#   non-secret: app_name, apps_domain, admin_email, github_allowlist, github_admin_login
#   secret:     github_client_id, github_client_secret, session_secret (openssl rand -hex 32)

# 3. Build the web bundle and push (vars.yml is interpolated into manifest.yml):
./scripts/cf-prepare.sh
cf push --vars-file vars.yml
```

`blogforge.config.tanzu` translates `VCAP_SERVICES` into the env the app reads — no manual DB / blob /
model wiring: `blogforge-postgres` → `BLOGFORGE_DATABASE_URL`, `blogforge-blobs` (Block Storage volume)
→ `BLOGFORGE_STORAGE_BACKEND=fs` + `BLOGFORGE_STORAGE_DIR=<mount>/blobs`, `blogforge-ai` →
`BLOGFORGE_TANZU_*` (the keyless **Tanzu** provider). Migrations run on first boot.
Sign in with GitHub; `github_admin_login` lands as admin. Local CLI providers are unavailable in ordinary cloud/container deployments unless deliberately installed and authenticated there.
Use the Tanzu model or API-key providers for a standard cloud deployment.

## Architecture

```
packages/
  api/blogforge/    FastAPI app — drafts, generation (SSE streaming), voice, auth, jobs
    voice/          absorbed myvoice: packs, lint/AI-tells, compose, enforce, fingerprint
    config/tanzu    VCAP_SERVICES → env adapter
  web/              React + TypeScript + Vite + Tailwind ("liquid-glass" UI), TipTap editor
```

- **Backend:** FastAPI · SQLAlchemy + Alembic (Postgres) or file-SQLite locally · filesystem
  (local `~/.blogforge` + Tanzu Block Storage volume) or S3/MinIO for blobs · SSE for live generation
  · per-user encrypted provider keys · GitHub OAuth sessions.
- **Frontend:** React Router SPA, served by the API with a catch-all fallback; ⌘K palette, toasts,
  autosave, command-driven flow.

## Requires

- At least one model: an **API key** for Anthropic / OpenAI / Google (in Settings), a bound **Tanzu**
  model (on Tanzu Platform, no key), **or** the **Claude Code CLI / Codex CLI** installed and logged in.
- A **GitHub OAuth App** for sign-in (GitHub is the only login method) —
  see [`docs/github-oauth-setup.md`](docs/github-oauth-setup.md).

## Development

```bash
./scripts/dev.sh             # backend :7880, Vite dev :7881
./scripts/serve-host.sh      # host API + web bundle on :7880 (enables local CLI providers)
./scripts/install-local.sh   # build wheel + install into local-venv/
make test                    # backend pytest + web vitest
```

Design specs live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
