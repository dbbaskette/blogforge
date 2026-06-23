# BlogForge

Local-first long-form drafting tool. Give BlogForge a topic and a [myvoice](https://github.com/dbbaskette/myvoice) style pack; it proposes an outline, lets you edit it, then writes the whole post in your voice — as one coherent piece, not a stack of disconnected sections.

## Why

[myvoice](https://github.com/dbbaskette/myvoice) gives writers a portable style pack and a Compose & test loop that rewrites paragraphs in their voice. BlogForge starts a level above: paste a topic, get a 1,000–3,000 word draft you can refine. Same voice rules, same lint, just a longer surface.

## How it works

Three stages per draft:

1. **Research** — paste URLs, files, or notes as references; chat with the LLM about your topic until the proposed outline feels right. Accept to move on.
2. **Outline** — edit the opening hook + section titles/briefs, reorder, or regenerate. The outline is planned as a single non-overlapping arc, with the section count right-sized to your target length (≈3–7 sections). References stay attached and inform every regeneration.
3. **Sections** — BlogForge composes the **entire post in a single pass** from the outline, then splits it back onto the sections so you can edit or regenerate any one of them. Generating the whole piece at once is what keeps it coherent and non-repetitive. Edit by hand, regenerate a section, or revise the whole draft against one instruction. Export when you're done.

Drafts (with their references and chat history) persist to Postgres + S3, multi-user, scoped per account. Bring your own database + object store, or use the bundled docker-compose stack below.

## Features

- **Single-pass, coherent generation** — the post is written start-to-finish in one call so sections build on each other instead of restating the thesis.
- **Inline AI editing** — select any text in the editor and rephrase / shorten / expand / fix / ask, in your voice.
- **Repurpose** — turn a finished draft into an X thread, LinkedIn post, newsletter blurb, TL;DR, SEO meta description, or announcement email.
- **Headline & hook lab** — generate and apply alternative titles or opening hooks.
- **Fact-check** — the Proofreader checks the draft's factual claims against your attached references (supported / unsupported / contradicted).
- **AI hero image** — generate a banner image with Google Imagen; embedded in the HTML export and added to the markdown frontmatter.
- **Proofreader** — myvoice style-rule lint plus a repetition check (duplicate paragraphs, recycled phrases, echoed openers).
- **Export** — Markdown, Markdown + YAML frontmatter, standalone HTML (hero image inlined), or Word (`.docx`).

## Providers & models

Pick a provider per draft:

- **Anthropic / OpenAI / Google** — API-key providers. Each user adds their own keys in **Settings → Provider API keys** (encrypted at rest; myvoice config is used as a fallback). Per-draft cost estimates are shown from a static rate card.
- **Tanzu** — on a Tanzu Platform deploy, a bound GenAI model is offered as the **Tanzu** provider with **no key required** (the model binding supplies the base URL + credentials). See **Tanzu Platform deployment** below.
- **Claude CLI (subscription)** — generate through your locally logged-in [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI (`claude -p`) instead of an API key, with web search on so Claude can research while it writes. Requires running the API on the host where `claude` is installed and authenticated — see **Using the Claude CLI** below.

## Quickstart (Docker)

Sign-in is **GitHub OAuth only** — there's no email/password. Before first start, register a GitHub OAuth App and set five env vars so the login button works.

1. Register a GitHub OAuth App (callback `http://localhost:7880/api/auth/github/callback`) and copy the Client ID + secret — full steps in [`docs/github-oauth-setup.md`](docs/github-oauth-setup.md).
2. Put the config in a `.env` file Docker Compose will load:

   ```bash
   BLOGFORGE_GITHUB_CLIENT_ID=<client-id>
   BLOGFORGE_GITHUB_CLIENT_SECRET=<client-secret>
   BLOGFORGE_GITHUB_ALLOWLIST=your-github-login   # comma-separated logins allowed to sign in
   BLOGFORGE_GITHUB_ADMIN_LOGIN=your-github-login  # which login becomes the admin
   BLOGFORGE_PUBLIC_URL=http://localhost:7880      # base URL used to build the OAuth callback
   ```

3. Start it:

   ```bash
   docker compose up --build
   ```

Then open http://localhost:7880. On first start the API container runs database migrations (`alembic upgrade head`), then click **Sign in with GitHub**.

- Only logins in `BLOGFORGE_GITHUB_ALLOWLIST` may sign in; anyone else is rejected. The login in `BLOGFORGE_GITHUB_ADMIN_LOGIN` becomes the admin on first sign-in.
- To add more users, add their GitHub login to the allowlist (or let them hit `/login`, which creates a pending request), then approve and manage roles under `/admin`.
- Each user adds their own LLM provider keys in **Settings → Provider API keys** (Anthropic / OpenAI / Google).

## Using the Claude CLI (subscription, no API key)

The `claude` binary isn't in the slim container, so to use the **Claude CLI** provider you run the API on your host (where Claude Code is installed and logged in) while Postgres/MinIO stay in Docker:

```bash
./scripts/serve-host.sh
```

This stops the containerized API, builds the web bundle into the API's static dir, and serves on http://localhost:7880 from your Mac. Confirm the CLI is authenticated first with `claude auth status`. Then pick **claude (CLI · subscription)** as the provider on a draft.

## Local dev (without Docker)

Run Postgres and MinIO via Docker, but the API/web from your host. Note the host-mapped Postgres port is **5433** (avoids colliding with a system Postgres on 5432):

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

(The GitHub OAuth vars are the same five from the Quickstart — see [`docs/github-oauth-setup.md`](docs/github-oauth-setup.md). `./scripts/serve-host.sh` and `./scripts/run-local.sh` default the allowlist/admin/public-URL for you.)

In another terminal, the web dev server:

```bash
cd packages/web && pnpm dev
# vite serves :7881; API calls hit :7880 via CORS with credentials
```

## Tanzu Platform deployment

Pure `cf push` with the `python_buildpack` — no Docker. Full guide in [`docs/cf-deploy.md`](docs/cf-deploy.md).

```bash
# 1. Bind the three services the manifest expects:
cf create-service postgres on-demand-postgres-small blogforge-postgres
cf create-service seaweedfs default blogforge-s3
cf create-service ai-models tanzu-all-models blogforge-ai   # bound GenAI model -> keyless "Tanzu" provider

# 2. Register a GitHub OAuth App (callback https://<route>/api/auth/github/callback),
#    then copy the secrets template and fill it in:
cp vars.example.yml vars.yml          # gitignored — holds non-secret config AND secrets, NEVER commit
#   non-secret: app_name, apps_domain, admin_email, github_allowlist, github_admin_login
#   secret:     github_client_id, github_client_secret, session_secret (openssl rand -hex 32)

# 3. Build the web bundle and push (vars.yml is interpolated into manifest.yml):
./scripts/cf-prepare.sh
cf push --vars-file vars.yml
```

The `blogforge.config.tanzu` adapter translates `VCAP_SERVICES` into the env vars the app reads, so no manual database / S3 / model wiring is needed: the `blogforge-postgres` binding sets `BLOGFORGE_DATABASE_URL`, `blogforge-s3` sets `BLOGFORGE_S3_*`, and `blogforge-ai` sets `BLOGFORGE_TANZU_API_BASE` / `BLOGFORGE_TANZU_API_KEY` (surfaced as the keyless **Tanzu** provider). Migrations run on first boot (`BLOGFORGE_RUN_MIGRATIONS_ON_BOOT=true`). Sign in with GitHub; the `github_admin_login` lands as admin. (The Claude CLI provider isn't available in a cloud deploy — use the Tanzu model or the API-key providers there.)

## Requires

- [myvoice](https://github.com/dbbaskette/myvoice) (BlogForge imports it as a library for pack loading + lint + prompt composition).
- At least one of: an **API key** for Anthropic / OpenAI / Google (added in **Settings → Provider API keys**), a bound **Tanzu** model (on a Tanzu Platform deploy, no key needed), **or** the **Claude Code CLI** installed and logged in (for the Claude CLI provider).
- A **GitHub OAuth App** for sign-in (GitHub is the only login method) — see [`docs/github-oauth-setup.md`](docs/github-oauth-setup.md).

## Design

Design specs live in `docs/superpowers/specs/` (e.g. `2026-05-26-pencraft-v1-design.md` — BlogForge was formerly "Pencraft" — plus auth, admin-keys, and research-stage designs).

## Development

```bash
./scripts/dev.sh             # backend on :7880, Vite dev on :7881
./scripts/serve-host.sh      # host API + web bundle on :7880 (enables the Claude CLI provider)
./scripts/install-local.sh   # build wheel + install into local-venv/
make test                    # backend pytest + web vitest
```
