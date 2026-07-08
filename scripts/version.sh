#!/usr/bin/env bash
# The one supported way to change BlogForge's version.
#
# The version lives in two files that MUST agree — the web bundle
# (packages/web/package.json, read by the build) and the API
# (packages/api/blogforge/__init__.py, served at /api/health). This script bumps
# both in lockstep following semver, so they can never drift.
#
#   scripts/version.sh                 # print the current version
#   scripts/version.sh check           # verify web + API agree (exit 1 if not)
#   scripts/version.sh patch           # 0.2.0 -> 0.2.1  (bug fixes only)
#   scripts/version.sh minor           # 0.2.0 -> 0.3.0  (backwards-compatible features)
#   scripts/version.sh major           # 0.2.0 -> 1.0.0  (breaking changes)
#   scripts/version.sh 1.4.2           # set an explicit version
#   scripts/version.sh minor --tag     # bump AND create annotated git tag v0.3.0
#
# After a bump, rebuild (scripts/serve-local.sh) so the running app reports it.
set -euo pipefail
cd "$(dirname "$0")/.."

PKG="packages/web/package.json"
INIT="packages/api/blogforge/__init__.py"

web_version() { node -p "require('./$PKG').version"; }
api_version() { sed -n 's/^__version__ = "\(.*\)"/\1/p' "$INIT"; }

CUR="$(web_version)"

# ── no args: print current ──
if [ $# -eq 0 ]; then
  echo "$CUR"
  exit 0
fi

# ── check: web and API must agree ──
if [ "$1" = "check" ]; then
  API="$(api_version)"
  if [ "$CUR" = "$API" ]; then
    echo "✓ version in sync: $CUR"
    exit 0
  fi
  echo "✗ version mismatch — web $PKG=$CUR, API $INIT=$API" >&2
  echo "  run: scripts/version.sh $CUR   (to resync)" >&2
  exit 1
fi

TAG=false
[ "${2:-}" = "--tag" ] && TAG=true

case "$1" in
  major|minor|patch)
    NEW="$(node -e '
      const [a,b,c] = process.argv[1].split(".").map(Number);
      const kind = process.argv[2];
      const next = kind === "major" ? [a+1,0,0] : kind === "minor" ? [a,b+1,0] : [a,b,c+1];
      console.log(next.join("."));
    ' "$CUR" "$1")"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    NEW="$1"
    ;;
  *)
    echo "usage: version.sh [check | major | minor | patch | X.Y.Z] [--tag]" >&2
    exit 1
    ;;
esac

# web package.json (canonical for the build) — rewrite via node to keep JSON valid
node -e '
  const fs = require("fs");
  const p = "./" + process.argv[1];
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.version = process.argv[2];
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$PKG" "$NEW"

# API __version__ (served at /api/health, FastAPI title)
perl -0pi -e "s/__version__ = \"[^\"]*\"/__version__ = \"$NEW\"/" "$INIT"

echo "  $CUR → $NEW"
echo "  updated $PKG"
echo "  updated $INIT"

if $TAG; then
  git tag -a "v$NEW" -m "Release v$NEW"
  echo "  created git tag v$NEW"
fi
