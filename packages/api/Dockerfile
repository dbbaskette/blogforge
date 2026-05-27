# Pencraft API — multi-stage build.
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

# Pencraft's pyproject.toml has `[tool.uv.sources]` pointing myvoice at
# ../myvoice (a sibling-repo editable install for local dev). Resolved
# relative to /app, that's /myvoice — fetch it from GitHub so the source
# override finds something at the expected path.
#
# Override the ref at build time with `--build-arg MYVOICE_REF=<sha-or-tag>`
# for reproducible images.
ARG MYVOICE_REF=main
RUN git clone --depth=1 --branch "${MYVOICE_REF}" \
        https://github.com/dbbaskette/myvoice /myvoice

# Copy project metadata.
COPY pyproject.toml uv.lock /app/
COPY packages/api /app/packages/api

# Copy the built web bundle into the API's static dir.
COPY --from=web /work/packages/web/dist /app/packages/api/pencraft/static

# Install Python deps (system install — production image, no venv).
RUN uv pip install --system --no-cache .

# Default port; override via $PORT in cloud envs.
ENV PORT=7880
EXPOSE 7880

CMD ["sh", "-c", "pencraft serve --host 0.0.0.0 --port ${PORT}"]
