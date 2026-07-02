#!/usr/bin/env bash
# Serve BlogForge on the host at http://localhost:7880 for local dev.
#
#   * DB: default SQLite at ~/.blogforge/blogforge.db (persists across restarts).
#   * No Docker — Postgres/MinIO not required (S3-backed features degrade, the
#     rest works).
#   * Claude CLI provider enabled: the ANTHROPIC_*/CLAUDE_* env of a launching
#     Claude Code session is scrubbed so `claude -p` resolves the host login.
#   * GitHub OAuth (sign-in is GitHub-only) + session secret load from
#     .env.local — copy .env.local.example, fill in your local OAuth App creds.
#
# The web bundle is rebuilt into the API static dir so the UI is current.
set -euo pipefail
cd "$(dirname "$0")/.."

# Local secrets: BLOGFORGE_GITHUB_* + BLOGFORGE_SESSION_SECRET + BLOGFORGE_PUBLIC_URL.
if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
else
  echo "⚠ .env.local not found — GitHub sign-in will be unconfigured. See .env.local.example." >&2
fi

command -v claude >/dev/null 2>&1 \
  && echo "✓ claude CLI: $(command -v claude)" \
  || echo "⚠ 'claude' not on PATH — the claude-cli provider will be unavailable" >&2

echo "▶ building web bundle into the API static dir…"
( cd packages/web && pnpm build >/dev/null )
rm -rf packages/api/blogforge/static
mkdir -p packages/api/blogforge/static
cp -R packages/web/dist/. packages/api/blogforge/static/

export BLOGFORGE_PUBLIC_URL="${BLOGFORGE_PUBLIC_URL:-http://localhost:7880}"
export BLOGFORGE_GITHUB_ALLOWLIST="${BLOGFORGE_GITHUB_ALLOWLIST:-dbbaskette}"
export BLOGFORGE_GITHUB_ADMIN_LOGIN="${BLOGFORGE_GITHUB_ADMIN_LOGIN:-dbbaskette}"

# Scrub the Claude Code session env so `claude -p` uses the host login instead
# of following ANTHROPIC_BASE_URL / the session OAuth token.
while IFS= read -r v; do unset "$v"; done < <(env | grep -oE '^(ANTHROPIC|CLAUDE)_[A-Za-z0-9_]+')

echo "▶ serving http://localhost:7880 (SQLite ~/.blogforge/blogforge.db, claude-cli enabled)"
exec .venv/bin/python -m blogforge serve --host 127.0.0.1 --port 7880 --no-browser
