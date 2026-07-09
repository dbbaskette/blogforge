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
