#!/usr/bin/env bash
# Require deployable changes to carry a synchronized, strictly newer version.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -ne 1 ]; then
  echo "usage: check-version-bump.sh BASE_REF" >&2
  exit 2
fi

base_ref="$1"
git rev-parse --verify "$base_ref^{commit}" >/dev/null
scripts/version.sh check >/dev/null

is_exempt() {
  local path="$1"
  case "$path" in
    docs/*|README.md|CHANGELOG.md) return 0 ;;
    e2e/*|packages/*/tests/*|*.test.*|*.spec.*|playwright.config.ts) return 0 ;;
    .github/*|.claude/*|.superpowers/*) return 0 ;;
    design-previews/*) return 0 ;;
    */*) return 1 ;;
    *.png|*.jpg|*.jpeg|*.gif|*.webp) return 0 ;;
    *) return 1 ;;
  esac
}

requires_bump=false
while IFS= read -r path; do
  if ! is_exempt "$path"; then
    requires_bump=true
    break
  fi
done < <(git diff --name-only --diff-filter=ACDMRT "$base_ref"...HEAD)

if ! $requires_bump; then
  echo "✓ changed files are version-bump exempt"
  exit 0
fi

base_web="$(
  git show "$base_ref:packages/web/package.json" |
    sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' |
    head -n 1
)"
base_api="$(
  git show "$base_ref:packages/api/blogforge/__init__.py" |
    sed -n 's/^__version__ = "\([^"]*\)"/\1/p'
)"
if [ -z "$base_web" ] || [ "$base_web" != "$base_api" ]; then
  echo "base version mismatch — web=$base_web api=$base_api" >&2
  exit 1
fi

candidate_version="$(scripts/version.sh)"
if ! scripts/version.sh compare "$base_web" "$candidate_version"; then
  echo "deployable changes require a newer version: baseline=$base_web candidate=$candidate_version" >&2
  echo "run: scripts/version.sh patch" >&2
  exit 1
fi

echo "✓ deployable changes advance version $base_web → $candidate_version"
