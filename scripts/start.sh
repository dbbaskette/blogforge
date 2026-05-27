#!/usr/bin/env bash
# Boot the Pencraft Docker stack (api + postgres + minio) detached, wait for
# the API to respond, then print useful URLs + credentials.
#
# Stop with `docker compose down` (or add `-v` to wipe data volumes).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' plugin not available" >&2
  exit 1
fi

echo "→ building + starting pencraft stack…"
docker compose up --build -d

echo "→ waiting for the API at http://localhost:7880/api/health…"
attempts=0
max_attempts=60   # ~2 min at 2s per attempt
until curl -fsS -o /dev/null http://localhost:7880/api/health 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "✗ API didn't respond within $((max_attempts * 2))s — check 'docker compose logs api'" >&2
    exit 1
  fi
  sleep 2
done

cat <<'BANNER'

  ✓ Pencraft is up.

  App         http://localhost:7880
  Health      http://localhost:7880/api/health
  MinIO UI    http://localhost:9001  (login: pencraft / pencraft-minio-secret)
  Postgres    localhost:5432         (db: pencraft, user/pass: pencraft / pencraft)

  Seeded admin
    email:    dbbaskette@gmail.com
    password: VMware0!

  Follow logs:  docker compose logs -f api
  Stop stack:   docker compose down          # keeps the data volumes
                docker compose down -v       # wipes postgres + minio volumes

BANNER
