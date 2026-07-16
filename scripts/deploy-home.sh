#!/usr/bin/env bash
# Deploy the reviewed origin/main release to home-services.local.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-home.sh

Deploy clean local main when it exactly matches origin/main. The production
host fast-forwards its own main checkout, runs redeploy.sh --sync, and verifies
both internal and public health/version responses.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then usage; exit 0; fi
if [ "$#" -ne 0 ]; then usage >&2; exit 2; fi

cd "$(dirname "$0")/.."

DEPLOY_HOST="${BLOGFORGE_DEPLOY_HOST:-blogforge-home}"
REMOTE_DIR="${BLOGFORGE_REMOTE_DIR:-/Users/dbbaskette/Projects/blogforge}"
SSH_BIN="${BLOGFORGE_SSH:-ssh}"
CURL_BIN="${BLOGFORGE_CURL:-curl}"
SSH_KEY="${BLOGFORGE_SSH_KEY:-$HOME/.ssh/blogforge_home_services}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

branch="$(git branch --show-current)"
[ "$branch" = main ] || { echo "deploy requires local branch main (found: ${branch:-detached})" >&2; exit 1; }
git diff --quiet || { echo "tracked local changes must be committed before deploy" >&2; exit 1; }
git diff --cached --quiet || { echo "tracked local changes must be committed before deploy" >&2; exit 1; }

echo "==> Fetching origin/main"
git fetch origin main
intended_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
[ "$intended_sha" = "$origin_sha" ] || {
  echo "local HEAD does not match origin/main; pull or push before deploy" >&2
  exit 1
}
[ -f "$SSH_KEY" ] || { echo "dedicated SSH key is missing: $SSH_KEY" >&2; exit 1; }

"$SSH_BIN" "${SSH_OPTS[@]}" "$DEPLOY_HOST" true

read -r -d '' REMOTE_PROGRAM <<'REMOTE' || true
set -euo pipefail
cd "$1"
previous_sha="$(git rev-parse HEAD)"
branch="$(git branch --show-current)"
if [ -n "$branch" ] && [ "$branch" != main ]; then
  echo "remote checkout must be main or detached rollback" >&2
  exit 1
fi
git diff --quiet || { echo "tracked remote changes block deploy" >&2; exit 1; }
git diff --cached --quiet || { echo "tracked remote changes block deploy" >&2; exit 1; }
git fetch origin main
git merge-base --is-ancestor "$previous_sha" origin/main || {
  echo "remote history is not fast-forwardable to origin/main" >&2
  exit 1
}
git checkout main
git merge --ff-only origin/main
deployed_sha="$(git rev-parse HEAD)"
[ "$deployed_sha" = "$2" ] || { echo "remote SHA differs from intended SHA" >&2; exit 1; }
scripts/redeploy.sh --sync
version="$(scripts/version.sh)"
health="$(curl -fsS --max-time 10 http://127.0.0.1:7880/api/health)"
printf 'BLOGFORGE_DEPLOY_RESULT\t%s\t%s\t%s\t%s\n' \
  "$previous_sha" "$deployed_sha" "$version" "$health"
REMOTE

echo "==> Fast-forwarding and redeploying $DEPLOY_HOST"
remote_output="$(printf '%s\n' "$REMOTE_PROGRAM" | \
  "$SSH_BIN" "${SSH_OPTS[@]}" "$DEPLOY_HOST" bash -s -- "$REMOTE_DIR" "$intended_sha")"
printf '%s\n' "$remote_output"

result_count="$(printf '%s\n' "$remote_output" | grep -c '^BLOGFORGE_DEPLOY_RESULT' || true)"
[ "$result_count" = 1 ] || { echo "remote deploy returned no unique result record" >&2; exit 1; }
result="$(printf '%s\n' "$remote_output" | grep '^BLOGFORGE_DEPLOY_RESULT')"
IFS=$'\t' read -r marker previous_sha deployed_sha version internal_health <<<"$result"
[ "$marker" = BLOGFORGE_DEPLOY_RESULT ] && [ -n "$previous_sha" ] && \
  [ -n "$deployed_sha" ] && [ -n "$version" ] && [ -n "$internal_health" ] || {
  echo "remote deploy returned a malformed result record" >&2; exit 1;
}
[ "$deployed_sha" = "$intended_sha" ] || { echo "deployed SHA does not match intended SHA" >&2; exit 1; }
printf '%s' "$internal_health" | grep -Fq "\"version\":\"$version\"" || {
  echo "internal health version does not match $version" >&2; exit 1;
}

public_health="$("$CURL_BIN" -fsS --max-time 15 https://blogforge.baskettecase.com/api/health)"
printf '%s' "$public_health" | grep -Fq "\"version\":\"$version\"" || {
  echo "public health version does not match $version" >&2; exit 1;
}

echo "✓ previous SHA: $previous_sha"
echo "✓ deployed SHA: $deployed_sha"
echo "✓ version: $version"
echo "✓ internal health: $internal_health"
echo "✓ public health: $public_health"
