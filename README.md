# Pencraft

Local-first long-form drafting tool. Give Pencraft a topic and a [myvoice](https://github.com/dbbaskette/myvoice) style pack; it proposes an outline, lets you edit it, then expands each section in your voice.

> **Status:** Phase 1 (v1). Design committed; implementation in progress.

## Why

[myvoice](https://github.com/dbbaskette/myvoice) gives writers a portable style pack and a Compose & test loop that rewrites paragraphs in their voice. Pencraft starts a level above: paste a topic, get a 1,000–3,000 word draft you can refine. Same voice rules, same lint, just a longer surface.

## How it works

Three stages per draft:

1. **Research** — paste URLs, files, or notes as references; chat with the LLM about your topic until the proposed outline feels right. Accept to move on.
2. **Outline** — edit titles, reorder, regenerate the opening hook + 5–9 sections with briefs. References stay attached and inform every regeneration.
3. **Sections** — Pencraft expands each section as the pack would (parallel, streaming), grounded in your references. Edit any section by hand or regenerate just that one. Download the assembled markdown when you're done.

Drafts (with their references and chat history) persist to Postgres + S3, multi-user, scoped per account. Bring your own database + object store, or use the bundled docker-compose stack below.

## Quickstart (Docker)

```bash
docker compose up --build
```

Then open http://localhost:7880 in your browser. The first time the API
container starts it will:

1. Run database migrations (`alembic upgrade head`).
2. Seed an admin user — `dbbaskette@gmail.com` / `VMware0!`.

Sign in with that account. To add more users, share the URL — anyone can
hit `/login`, click **Request access**, and submit. You'll see them in
`/admin` and can approve.

![3-stage flow](docs/screenshots/pencraft-flow.png)

## Local dev (without Docker)

Run Postgres and MinIO via Docker, but the API/web from your host:

```bash
docker compose up postgres minio -d
PENCRAFT_DATABASE_URL="postgresql+asyncpg://pencraft:pencraft@localhost:5432/pencraft" \
PENCRAFT_S3_ENDPOINT_URL="http://localhost:9000" \
PENCRAFT_S3_ACCESS_KEY=pencraft \
PENCRAFT_S3_SECRET_KEY=pencraft-minio-secret \
PENCRAFT_S3_BUCKET=pencraft \
PENCRAFT_ADMIN_EMAIL=dbbaskette@gmail.com \
PENCRAFT_ADMIN_PASSWORD=VMware0! \
PENCRAFT_CORS_ORIGINS=http://localhost:7881 \
  uv run pencraft serve --port 7880
```

In another terminal, the web dev server:

```bash
cd packages/web && pnpm dev
# vite serves :7881; API calls hit :7880 via CORS with credentials
```

## Tanzu Platform deployment

```bash
cf create-service postgres on-demand-postgres-small pencraft-postgres
cf create-service seaweedfs default pencraft-s3
cf push -f manifest.yml
cf set-env pencraft PENCRAFT_ADMIN_PASSWORD '<your-strong-secret>'
cf set-env pencraft PENCRAFT_SESSION_SECRET "$(openssl rand -hex 32)"
cf restage pencraft
```

The `pencraft.config.tanzu` adapter translates `VCAP_SERVICES` into the
env vars the app reads, so no manual database / S3 wiring is needed.

Pencraft reads LLM API keys from `~/.myvoice/config.yaml`. Add at least one provider key in myvoice's Settings page (`localhost:7878`) before generating.

## Requires

- [myvoice](https://github.com/dbbaskette/myvoice) installed and configured (Pencraft imports `myvoice` as a library for pack loading + lint + prompt composition).
- An API key for one of: Anthropic, OpenAI, Google. Set in myvoice's Settings.

## Design

See `docs/superpowers/specs/2026-05-26-pencraft-v1-design.md`.

## Development

```bash
./scripts/dev.sh         # backend on :7880, Vite dev on :7881
./scripts/install-local.sh   # build wheel + install into local-venv/
./scripts/run-local.sh       # run the installed wheel
```
