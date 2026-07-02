#!/usr/bin/env bash
# Stage the web bundle into the API's static dir before `cf push`
# (the python_buildpack cannot build Node).
set -euo pipefail
cd "$(dirname "$0")/.."

# Build identity, baked into the bundle (Vite) and written for the API's
# /api/health — the git SHA changes every deploy, so it answers "is the right
# version live?" (the semver usually doesn't move).
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
APP_VERSION="$(node -p "require('./packages/web/package.json').version" 2>/dev/null || echo 0.1.0)"
echo "▶ build id: v${APP_VERSION} · ${GIT_SHA} · ${BUILD_TIME}"

echo "▶ building web bundle…"
pnpm -C packages/web install --frozen-lockfile
VITE_APP_VERSION="$APP_VERSION" VITE_GIT_SHA="$GIT_SHA" VITE_BUILD_TIME="$BUILD_TIME" \
  pnpm -C packages/web build
rm -rf packages/api/blogforge/static
cp -r packages/web/dist packages/api/blogforge/static

# Drop the build id where the API can read it (served dir is gitignored + deployed).
printf '{"version":"%s","commit":"%s","built_at":"%s"}\n' \
  "$APP_VERSION" "$GIT_SHA" "$BUILD_TIME" > packages/api/blogforge/static/build_info.json

echo "✓ web bundle staged at packages/api/blogforge/static"
echo "  next: cf push --vars-file vars.yml"
