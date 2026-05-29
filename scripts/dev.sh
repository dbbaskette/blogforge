#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Backend on :7880 (dev mode = no static bundle required)
MYVOICE_DEV=1 uv run blogforge serve --no-browser --dev --port 7880 &
BACKEND_PID=$!

# Frontend on :7881 (proxies /api/* → :7880)
cd packages/web && pnpm dev --port 7881 --host 127.0.0.1 &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true" EXIT
wait
