#!/usr/bin/env bash
# Run the BlogForge API locally, self-contained — no Docker required.
#
#   * DB: a file-backed SQLite at ./local-data/blogforge.db (persists across
#     restarts; the in-memory default can't actually serve — migrations run on
#     a throwaway connection the app never sees).
#   * S3 bootstrap is OFF so boot doesn't require MinIO. S3-backed features
#     (file references, hero images, uploaded voice samples) still need MinIO —
#     bring it up with `scripts/start.sh` or `docker compose up -d minio`; the
#     S3 endpoint below already points at it. The rest of the app runs without it.
#
# Serves on :7882 (not :7880, so it won't clash with the Docker stack). Override
# with PORT=xxxx. Admin login: dbbaskette@gmail.com / VMware0!
set -euo pipefail
cd "$(dirname "$0")/.."

# Ensure local-venv has blogforge installed EDITABLE (from source) — a
# non-editable copy can't find the alembic migrations (they live in the source
# tree, not the wheel) and would run stale code.
if [ ! -f local-venv/lib/python3.11/site-packages/_editable_impl_blogforge.pth ]; then
  echo "▶ installing blogforge (editable) into local-venv…"
  uv pip install -e . --no-deps --python local-venv/bin/python >/dev/null
fi

mkdir -p local-data
export BLOGFORGE_DATABASE_URL="sqlite+aiosqlite:///$(pwd)/local-data/blogforge.db"
export BLOGFORGE_S3_BOOTSTRAP_ON_BOOT="false"
export BLOGFORGE_S3_ENDPOINT_URL="http://localhost:9000"
export BLOGFORGE_S3_ACCESS_KEY="blogforge"
export BLOGFORGE_S3_SECRET_KEY="blogforge-minio-secret"
export BLOGFORGE_S3_BUCKET="blogforge"
export BLOGFORGE_SESSION_SECRET="dev-session-secret-change-me"
export BLOGFORGE_ADMIN_EMAIL="dbbaskette@gmail.com"
export BLOGFORGE_ADMIN_PASSWORD="VMware0!"
export BLOGFORGE_CORS_ORIGINS="http://localhost:7882"
export BLOGFORGE_GITHUB_CLIENT_ID="${BLOGFORGE_GITHUB_CLIENT_ID:-}"
export BLOGFORGE_GITHUB_CLIENT_SECRET="${BLOGFORGE_GITHUB_CLIENT_SECRET:-}"
export BLOGFORGE_GITHUB_ALLOWLIST="${BLOGFORGE_GITHUB_ALLOWLIST:-dbbaskette}"
export BLOGFORGE_GITHUB_ADMIN_LOGIN="${BLOGFORGE_GITHUB_ADMIN_LOGIN:-dbbaskette}"
export BLOGFORGE_PUBLIC_URL="${BLOGFORGE_PUBLIC_URL:-http://localhost:7882}"

PORT="${PORT:-7882}"

# Default to `serve` when no command is given; forward any extra args.
if [ "$#" -eq 0 ]; then
  echo "▶ serving on http://localhost:${PORT} (admin: dbbaskette@gmail.com / VMware0!)"
  exec local-venv/bin/blogforge serve --host 0.0.0.0 --port "$PORT" --browser
fi
exec local-venv/bin/blogforge "$@"
