# Tanzu Buildpack Deploy — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan.
**Scope:** Make BlogForge deployable on Tanzu Platform (ndc) via `cf push` + the classic `python_buildpack`, with no external dependency and no Docker image. Final sub-project of the TP epic (GitHub auth ✅, manifest vars ✅, myvoice absorbed ✅, AI-tells ✅).

## Goal
- `./scripts/cf-prepare.sh && cf push --vars-file vars.yml` deploys a working BlogForge to ndc.
- App runs **from source** (no `pip install .`) so Alembic's source-relative migration path resolves on boot.
- No code dependency on a package index that lacks `myvoice` (already absorbed) or on a container registry.

## Why these choices (settled)
- `diego_cnb` is **disabled** on ndc → no Cloud Native Buildpacks; `diego_docker` enabled but the user prefers a pure `cf push`. → **classic `python_buildpack`**.
- The buildpack installs deps from `requirements.txt` and runs the start command from `/home/vcap/app`; it does **not** build Node and does **not** `pip install` the app. So the web bundle is staged pre-push, and the app runs from source via `PYTHONPATH`.
- Installing the app (`pip install .`) would put `blogforge/server.py` in site-packages, breaking `Path(__file__).resolve().parents[1] / "alembic"` (the documented editable-install requirement). Running from source with `PYTHONPATH=packages/api` keeps `alembic/` at `parents[1]` (verified locally: import + alembic dir both resolve).

## Architecture / deliverables

### 1 · Module entry point (`packages/api/blogforge/__main__.py`)
```python
from blogforge.cli import main

main()
```
Enables `python -m blogforge serve …` (the `blogforge` console script is unavailable since the app isn't installed). `cli.serve` already accepts `--host/--port/--no-browser` (default is no-browser).

### 2 · Manifest start command (`manifest.yml`)
Change the start command to run from source, and add `PYTHONPATH` to the env map:
```yaml
    command: python -m blogforge serve --host 0.0.0.0 --port $PORT --no-browser
    env:
      PYTHONPATH: packages/api
      # …existing vars-driven env unchanged…
```
Everything else in the manifest (routes `((app_name)).((apps_domain))`, `blogforge-postgres` + `blogforge-s3` services, `BLOGFORGE_PUBLIC_URL`/`ADMIN_EMAIL`/`GITHUB_ALLOWLIST`/`GITHUB_ADMIN_LOGIN` from vars, `RUN_MIGRATIONS_ON_BOOT=true`) stays. Add `BLOGFORGE_COOKIE_SECURE: "true"` (TP serves over TLS) if not already present.

### 3 · Dependencies (`requirements.txt`, `runtime.txt`)
- Rename `requirements.lock` → **`requirements.txt`** (the buildpack's auto-detected input; it's already pip-clean — no `myvoice`/editable/path refs). Update `packages/api/Dockerfile` to install from `requirements.txt` (one lockfile, both deploy paths). Update any `uv export … -o requirements.lock` references in docs to `requirements.txt`.
- Add **`runtime.txt`** = `python-3.11.x` (a `python_buildpack`-supported 3.11 patch; the implementer picks a supported version, e.g. the latest 3.11 the buildpack ships).

### 4 · Web-bundle staging (`scripts/cf-prepare.sh`)
A pre-push script (the buildpack can't build Node):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm -C packages/web install --frozen-lockfile
pnpm -C packages/web build
rm -rf packages/api/blogforge/static
cp -r packages/web/dist packages/api/blogforge/static
echo "✓ web bundle staged at packages/api/blogforge/static"
```
`static/` is gitignored, but `cf push` ships working-dir files, so the staged bundle uploads (as long as `.cfignore` doesn't exclude it).

### 5 · `.cfignore`
Keep the droplet small and correct.
- **Exclude:** `.git`, `.venv`, `local-venv`, `**/node_modules`, `packages/web` (we ship only the copied `static/`), `local-data`, `docs`, `**/__pycache__`, `.pytest_cache`, `**/tests`, `*.db`, `vars.yml`, `vars-*.yml` (read by `--vars-file`, not uploaded).
- **Keep:** `packages/api/**` (incl. `blogforge/static`), `requirements.txt`, `runtime.txt`, `manifest.yml`, `pyproject.toml`, `README.md`, `Procfile` (none needed — manifest `command` suffices).

### 6 · Docs (`docs/cf-deploy.md`)
The end-to-end flow:
1. `cp vars.example.yml vars.yml` and fill it (app name, apps domain, allowlist, admin).
2. Register the GitHub OAuth App for the route (`https://<app>.<domain>/api/auth/github/callback`) — see `docs/github-oauth-setup.md`.
3. Ensure `blogforge-postgres` + `blogforge-s3` service instances exist (`cf create-service …`).
4. `./scripts/cf-prepare.sh`
5. `cf push --vars-file vars.yml`
6. `cf set-env <app> BLOGFORGE_GITHUB_CLIENT_ID/SECRET` + `BLOGFORGE_SESSION_SECRET $(openssl rand -hex 32)`; `cf restage <app>`.
7. Visit `https://<app>.<domain>`, Sign in with GitHub.

## Testing / verification
No real CF in the test suite. Local, scriptable checks:
- `cf-prepare.sh` produces `packages/api/blogforge/static/index.html`.
- Run-from-source boots: `PYTHONPATH=packages/api BLOGFORGE_DATABASE_URL=sqlite+aiosqlite:///./.cf-smoke.db BLOGFORGE_RUN_MIGRATIONS_ON_BOOT=true .venv/bin/python -m blogforge serve --host 127.0.0.1 --port 7899 --no-browser` → `GET /` returns the SPA `index.html` (200) and `GET /api/health` 200; then stop. (Proves the `__main__` entry, PYTHONPATH import, alembic-on-boot, and static serving all work the way CF will run them.)
- `requirements.txt` installs clean in a throwaway venv (`python -m venv /tmp/v && /tmp/v/bin/pip install -r requirements.txt` succeeds, no `myvoice`/path errors).
- The existing API suite stays green (the only code change is the trivial `__main__.py`).

## Out of scope
- CI/CD automation (GitHub Actions) — local `cf-prepare.sh` is enough for now.
- The bound Tanzu GenAI model provider; per-user API keys (deferred epic items).
- The actual `cf push` to ndc (the user runs it on their foundation with their secrets).

## Success criteria
1. `./scripts/cf-prepare.sh` stages the web bundle; the run-from-source smoke serves the SPA + `/api/health` locally.
2. `requirements.txt` (+ `runtime.txt`) install cleanly with no external/path deps; Dockerfile uses the same `requirements.txt`.
3. `.cfignore` excludes heavyweight/source dirs and keeps `packages/api/**` (incl. `static/`).
4. `manifest.yml` runs `python -m blogforge serve …` with `PYTHONPATH=packages/api`; migrations run on boot.
5. `docs/cf-deploy.md` documents the full push flow; existing suite green.
