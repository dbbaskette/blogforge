#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Build the wheel (includes bundled frontend)
rm -rf packages/api/pencraft/static
cd packages/web && pnpm install && pnpm build
cd ../..
mkdir -p packages/api/pencraft/static
cp -R packages/web/dist/* packages/api/pencraft/static/
uv build

# Install into an isolated venv
rm -rf local-venv
uv venv local-venv --python 3.11
local-venv/bin/python -m pip install dist/pencraft-*.whl

echo
echo "Installed. Run with: ./scripts/run-local.sh"
