#!/usr/bin/env bash
# Run the BlogForge API on the HOST so it can shell out to a logged-in local
# CLI provider (`claude` or `codex`). The slim container can't reach the
# authenticated host CLIs, so generation moves to the host.
#
# Postgres + MinIO stay in Docker; the containerized `api` is stopped to free
# port 7880. The web bundle is built into the API's static dir so the full app
# is served at http://localhost:7880 (same as the container experience).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "❌ No supported local CLI is on PATH. Install and authenticate Claude CLI or Codex CLI." >&2
  exit 1
fi

command -v claude >/dev/null 2>&1 && echo "✓ claude CLI: $(command -v claude) ($(claude --version 2>/dev/null | head -1))"
command -v codex >/dev/null 2>&1 && echo "✓ codex CLI: $(command -v codex) ($(codex --version 2>/dev/null | head -1))"

echo "▶ ensuring Postgres + MinIO are up…"
docker compose up -d postgres minio >/dev/null
echo "▶ stopping the containerized api (the host process takes :7880)…"
docker compose stop api >/dev/null 2>&1 || true

echo "▶ building the web bundle into the API static dir…"
( cd packages/web && pnpm build >/dev/null )
rm -rf packages/api/blogforge/static
mkdir -p packages/api/blogforge/static
cp -R packages/web/dist/. packages/api/blogforge/static/

# Point the host process at the Docker-mapped Postgres/MinIO ports.
export BLOGFORGE_DATABASE_URL="postgresql+asyncpg://blogforge:blogforge@localhost:5433/blogforge"
export BLOGFORGE_S3_ENDPOINT_URL="http://localhost:9000"
export BLOGFORGE_S3_ACCESS_KEY="blogforge"
export BLOGFORGE_S3_SECRET_KEY="blogforge-minio-secret"
export BLOGFORGE_S3_BUCKET="blogforge"
export BLOGFORGE_SESSION_SECRET="dev-session-secret-change-me"
export BLOGFORGE_ADMIN_EMAIL="dbbaskette@gmail.com"
export BLOGFORGE_ADMIN_PASSWORD="VMware0!"
export BLOGFORGE_CORS_ORIGINS="http://localhost:7881"
export BLOGFORGE_GITHUB_CLIENT_ID="${BLOGFORGE_GITHUB_CLIENT_ID:-}"
export BLOGFORGE_GITHUB_CLIENT_SECRET="${BLOGFORGE_GITHUB_CLIENT_SECRET:-}"
export BLOGFORGE_GITHUB_ALLOWLIST="${BLOGFORGE_GITHUB_ALLOWLIST:-dbbaskette}"
export BLOGFORGE_GITHUB_ADMIN_LOGIN="${BLOGFORGE_GITHUB_ADMIN_LOGIN:-dbbaskette}"
export BLOGFORGE_PUBLIC_URL="${BLOGFORGE_PUBLIC_URL:-http://localhost:7880}"

RUN="uv run blogforge"
[ -x ".venv/bin/blogforge" ] && RUN=".venv/bin/blogforge"

echo "▶ serving on http://localhost:7880 — detected local CLI providers are available."
exec $RUN serve --host 0.0.0.0 --port 7880 --browser
