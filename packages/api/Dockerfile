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
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv (pinned via pip; smaller than the standalone installer).
RUN pip install --no-cache-dir uv==0.5.0

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
