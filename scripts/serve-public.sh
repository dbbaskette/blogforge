#!/usr/bin/env bash
# Serve BlogForge on the host for the public deploy (blogforge.baskettecase.com).
# SQLite + fs blobs in ~/.blogforge; the claude-cli provider authenticates via
# CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) set in .env.public.
# Supervised by the launchd agent com.baskettecase.blogforge. No rebuild on
# start — build the web bundle + `uv sync` at install/update time.
set -euo pipefail
cd "$(dirname "$0")/.."

# Use the Homebrew-installed claude (/usr/local/bin) for the service, pinned
# explicitly so the resolved binary doesn't depend on login-shell PATH order.
# (The ~/.local/bin claude is the Desktop app's — left alone.)
export PATH="/usr/local/bin:$PATH"

[ -f .env.public ] && { set -a; . ./.env.public; set +a; } || { echo "❌ .env.public missing" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || { echo "❌ 'claude' not on PATH — the claude-cli provider will be unavailable" >&2; exit 1; }
echo "✓ claude CLI: $(command -v claude)"

# Scrub inherited Claude Code *session* env (ANTHROPIC_BASE_URL,
# CLAUDE_CODE_SESSION_ID, …) so `claude -p` doesn't chase a desktop-session
# token — but PRESERVE the long-lived credential we set in .env.public
# (from `claude setup-token`), which is how a background service authenticates.
while IFS= read -r v; do
  case "$v" in CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY) continue ;; esac
  unset "$v"
done < <(env | grep -oE '^(ANTHROPIC|CLAUDE)_[A-Za-z0-9_]+' || true)

# Bind 0.0.0.0 so the cloudflared container reaches us via host.docker.internal
# (Docker Desktop's gateway can't reach a 127.0.0.1-only bind). Access is still
# gated by GitHub OAuth (allowlist), and the tunnel is the intended entrypoint.
echo "▶ serving http://0.0.0.0:7880 (SQLite ~/.blogforge, claude-cli enabled)"
exec .venv/bin/blogforge serve --host 0.0.0.0 --port 7880 --no-browser
