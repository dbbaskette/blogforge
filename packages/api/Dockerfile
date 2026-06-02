# syntax=docker/dockerfile:1
# BlogForge API — multi-stage build.
# 1) Build the web bundle.
# 2) Install Python deps via uv.
# 3) Slim runtime image with the web bundle baked in.

# ---- web bundle stage ----
FROM node:20-alpine AS web
WORKDIR /work
RUN apk add --no-cache git && npm install -g pnpm@9
COPY packages/web/package.json packages/web/pnpm-lock.yaml /work/packages/web/
WORKDIR /work/packages/web
RUN pnpm install --frozen-lockfile
COPY packages/web /work/packages/web
RUN pnpm build

# ---- runtime stage ----
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Install uv (pinned via pip; smaller than the standalone installer).
RUN pip install --no-cache-dir uv==0.5.0

# BlogForge's pyproject.toml has `[tool.uv.sources]` pointing myvoice at
# ../myvoice (a sibling-repo editable install for local dev). Resolved
# relative to /app, that's /myvoice — fetch it from GitHub so the source
# override finds something at the expected path.
#
# Override the ref at build time with `--build-arg MYVOICE_REF=<sha-or-tag>`
# for reproducible images.
ARG MYVOICE_REF=main
RUN git clone --depth=1 --branch "${MYVOICE_REF}" \
        https://github.com/dbbaskette/myvoice /myvoice

# Copy project metadata + the pinned dependency lock. README is required
# because pyproject.toml declares `readme = "README.md"` and hatchling
# validates the file at wheel-build time.
COPY pyproject.toml uv.lock README.md requirements.lock /app/

# Install PINNED dependencies BEFORE copying app source. Two reasons this
# matters:
#   1. Determinism — `uv pip install -e .` re-resolves to the latest matching
#      releases on every build (e.g. idna 3.16 → 3.18), so a freshly-published
#      transitive dep is a cache miss → fresh download → build breaks the moment
#      the network hiccups. requirements.lock pins exact versions, so the
#      BuildKit uv cache stays valid build-to-build.
#   2. Layer caching — keyed only on the lockfiles, so editing application code
#      never re-runs this step. Code-only rebuilds are fully offline.
# `-e ../myvoice` in requirements.lock resolves to /myvoice (cloned above) from
# WORKDIR /app. Regenerate the lock after changing deps with:
#   uv export --frozen --no-emit-project --no-dev --no-hashes -o requirements.lock
ENV UV_CACHE_DIR=/root/.cache/uv
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -r requirements.lock

COPY packages/api /app/packages/api

# Copy the built web bundle into the API's static dir.
COPY --from=web /work/packages/web/dist /app/packages/api/blogforge/static

# Install the project itself — editable so alembic/ + alembic.ini at the
# source tree's well-known paths (parents[1] of blogforge/server.py) stay
# reachable at runtime (a non-editable wheel puts __file__ in site-packages/
# and the migrations lookup resolves into alembic's own dir, crashing on boot).
# --no-deps: dependencies are already installed from requirements.lock above.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-deps -e .

# Default port; override via $PORT in cloud envs.
ENV PORT=7880
EXPOSE 7880

CMD ["sh", "-c", "blogforge serve --host 0.0.0.0 --port ${PORT} --no-browser"]
