#!/usr/bin/env bash
# Explicitly roll production back to a commit reachable from origin/main.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/rollback-home.sh [--yes] <commit>

Deploy a historical commit reachable from origin/main in detached-HEAD state.
Without --yes, the operator must type the exact word "rollback".
EOF
}

YES=0
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --yes) YES=1; shift ;;
  -*) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
esac
[ "$#" -eq 1 ] || { usage >&2; exit 2; }
revision="$1"

cd "$(dirname "$0")/.."

DEPLOY_HOST="${BLOGFORGE_DEPLOY_HOST:-blogforge-home}"
REMOTE_DIR="${BLOGFORGE_REMOTE_DIR:-/Users/dbbaskette/Projects/blogforge}"
SSH_BIN="${BLOGFORGE_SSH:-ssh}"
CURL_BIN="${BLOGFORGE_CURL:-curl}"
SSH_KEY="${BLOGFORGE_SSH_KEY:-$HOME/.ssh/blogforge_home_services}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

if [ "$YES" -ne 1 ]; then
  printf 'Type rollback to deploy %s to %s: ' "$revision" "$DEPLOY_HOST"
  read -r answer
  [ "$answer" = rollback ] || { echo "rollback cancelled" >&2; exit 1; }
fi

[ -f "$SSH_KEY" ] || { echo "dedicated SSH key is missing: $SSH_KEY" >&2; exit 1; }
"$SSH_BIN" "${SSH_OPTS[@]}" "$DEPLOY_HOST" true

read -r -d '' REMOTE_PROGRAM <<'REMOTE' || true
set -euo pipefail
cd "$1"
git diff --quiet || { echo "tracked remote changes block rollback" >&2; exit 1; }
git diff --cached --quiet || { echo "tracked remote changes block rollback" >&2; exit 1; }
git fetch origin main
rollback_sha="$(git rev-parse --verify "$2^{commit}")"
git merge-base --is-ancestor "$rollback_sha" origin/main || {
  echo "rollback commit is not reachable from origin/main" >&2
  exit 1
}
previous_sha="$(git rev-parse HEAD)"
git checkout --detach "$rollback_sha"
scripts/redeploy.sh --sync
version="$(scripts/version.sh)"
health="$(curl -fsS --max-time 10 http://127.0.0.1:7880/api/health)"
printf 'BLOGFORGE_ROLLBACK_RESULT\t%s\t%s\t%s\t%s\n' \
  "$previous_sha" "$rollback_sha" "$version" "$health"
REMOTE

echo "==> Rolling back $DEPLOY_HOST to $revision"
remote_output="$(printf '%s\n' "$REMOTE_PROGRAM" | \
  "$SSH_BIN" "${SSH_OPTS[@]}" "$DEPLOY_HOST" bash -s -- "$REMOTE_DIR" "$revision")"
printf '%s\n' "$remote_output"

result_count="$(printf '%s\n' "$remote_output" | grep -c '^BLOGFORGE_ROLLBACK_RESULT' || true)"
[ "$result_count" = 1 ] || { echo "remote rollback returned no unique result record" >&2; exit 1; }
result="$(printf '%s\n' "$remote_output" | grep '^BLOGFORGE_ROLLBACK_RESULT')"
IFS=$'\t' read -r marker previous_sha rollback_sha version internal_health <<<"$result"
[ "$marker" = BLOGFORGE_ROLLBACK_RESULT ] && [ -n "$previous_sha" ] && \
  [ -n "$rollback_sha" ] && [ -n "$version" ] && [ -n "$internal_health" ] || {
  echo "remote rollback returned a malformed result record" >&2; exit 1;
}
printf '%s' "$internal_health" | grep -Fq "\"version\":\"$version\"" || {
  echo "internal health version does not match $version" >&2; exit 1;
}

public_health="$("$CURL_BIN" -fsS --max-time 15 https://blogforge.baskettecase.com/api/health)"
printf '%s' "$public_health" | grep -Fq "\"version\":\"$version\"" || {
  echo "public health version does not match $version" >&2; exit 1;
}

echo "✓ previous SHA: $previous_sha"
echo "✓ rollback SHA: $rollback_sha"
echo "✓ version: $version"
echo "✓ internal health: $internal_health"
echo "✓ public health: $public_health"
