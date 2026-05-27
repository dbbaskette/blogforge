#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Default to `serve` when no command is given; forward any extra args.
if [ "$#" -eq 0 ]; then
  exec local-venv/bin/pencraft serve
fi
exec local-venv/bin/pencraft "$@"
