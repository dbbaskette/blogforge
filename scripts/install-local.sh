#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
MYVOICE_PATH="${MYVOICE_PATH:-$REPO_ROOT/../myvoice}"

if [ ! -d "$MYVOICE_PATH" ]; then
  echo "error: myvoice not found at $MYVOICE_PATH"
  echo "set MYVOICE_PATH to the myvoice repo root, e.g.:"
  echo "  MYVOICE_PATH=/path/to/myvoice ./scripts/install-local.sh"
  exit 1
fi

# Build wheel (includes bundled frontend)
echo "==> Building frontend"
rm -rf packages/api/blogforge/static
(cd packages/web && pnpm install && pnpm build)
mkdir -p packages/api/blogforge/static
cp -R packages/web/dist/* packages/api/blogforge/static/

echo "==> Building wheel"
rm -rf dist
uv build

# Fresh venv
echo "==> Creating venv at local-venv/"
rm -rf local-venv
uv venv local-venv --python 3.11

# Install myvoice editable first (not on PyPI yet) then the blogforge wheel.
# Using `uv pip install --python` avoids needing pip inside the venv.
echo "==> Installing myvoice from $MYVOICE_PATH"
uv pip install --python local-venv/bin/python -e "$MYVOICE_PATH"

echo "==> Installing blogforge wheel"
WHEEL=$(ls -1 dist/blogforge-*.whl | head -1)
uv pip install --python local-venv/bin/python "$WHEEL"

echo
echo "Installed. Run with: ./scripts/run-local.sh"
