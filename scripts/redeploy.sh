#!/usr/bin/env bash
# Redeploy the launchd-supervised host instance (blogforge.baskettecase.com on
# :7880, supervised by com.baskettecase.blogforge).
#
# serve-public.sh deliberately does NOT rebuild on start, so the web bundle must
# be built and staged into packages/api/blogforge/static/ here — skip that and
# you restart into the OLD UI. The API is an editable install, so a restart is
# enough to pick up Python source changes; `uv sync` is only needed when
# dependencies actually change.
#
# Deploys whatever is currently checked out. Verifies the running app reports the
# version in packages/web/package.json before declaring success.
#
#   scripts/redeploy.sh               # build bundle + restart + verify
#   scripts/redeploy.sh --skip-build  # backend-only change: restart + verify
#   scripts/redeploy.sh --sync        # dependencies changed: also `uv sync`
set -euo pipefail
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."

AGENT="com.baskettecase.blogforge"
PORT=7880
SKIP_BUILD=0
SYNC=0

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; }

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --sync) SYNC=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

EXPECTED="$(scripts/version.sh)"
echo "==> Redeploying v$EXPECTED from $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD))"

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "==> Building web bundle"
  ( cd packages/web && pnpm build )
  echo "==> Staging bundle -> packages/api/blogforge/static/"
  rm -rf packages/api/blogforge/static
  mkdir -p packages/api/blogforge/static
  cp -R packages/web/dist/. packages/api/blogforge/static/
else
  echo "==> Skipping web build (--skip-build); serving the existing bundle"
fi

if [ "$SYNC" -eq 1 ]; then
  echo "==> uv sync (dependencies)"
  uv sync
fi

echo "==> Restarting $AGENT"
launchctl kickstart -k "gui/$(id -u)/$AGENT"

echo "==> Waiting for :$PORT to report v$EXPECTED"
H=""
for _ in $(seq 1 20); do
  H="$(curl -s --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null || true)"
  if printf '%s' "$H" | grep -q "\"version\":\"$EXPECTED\""; then
    echo "✓ live: $H"
    exit 0
  fi
  sleep 1
done

echo "❌ :$PORT did not report v$EXPECTED within 20s" >&2
echo "   last response: ${H:-<none>}" >&2
echo "   logs: tail -50 ~/.blogforge/serve.log" >&2
exit 1
