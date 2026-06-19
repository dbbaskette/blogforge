#!/usr/bin/env bash
# Stage the web bundle into the API's static dir before `cf push`
# (the python_buildpack cannot build Node).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "▶ building web bundle…"
pnpm -C packages/web install --frozen-lockfile
pnpm -C packages/web build
rm -rf packages/api/blogforge/static
cp -r packages/web/dist packages/api/blogforge/static
echo "✓ web bundle staged at packages/api/blogforge/static"
echo "  next: cf push --vars-file vars.yml"
