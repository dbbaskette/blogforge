# Tanzu Buildpack Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BlogForge deployable on Tanzu (ndc) via `cf push` + `python_buildpack`, running from source (no app install, no Docker, no external dep).

**Architecture:** Add a `python -m blogforge` entry point and run it from source with `PYTHONPATH=packages/api` (so Alembic's source-relative path resolves); feed the buildpack a committed `requirements.txt` + `runtime.txt`; stage the web bundle into `blogforge/static` pre-push via `scripts/cf-prepare.sh`; trim the droplet with `.cfignore`.

**Tech Stack:** Cloud Foundry python_buildpack, FastAPI/uvicorn, pnpm/vite, alembic.

> **Spec:** `docs/superpowers/specs/2026-06-19-cf-buildpack-deploy-design.md`
> **Test command:** `cd /Users/dbbaskette/Projects/BlogForge && .venv/bin/python -m pytest <path> -q`

---

## File Structure
- Create `packages/api/blogforge/__main__.py` — `python -m blogforge` entry.
- Modify `manifest.yml` — run-from-source command + `PYTHONPATH` + `COOKIE_SECURE`.
- Rename `requirements.lock` → `requirements.txt`; modify `packages/api/Dockerfile` to match.
- Create `runtime.txt` — Python version pin.
- Create `scripts/cf-prepare.sh` — web-bundle staging.
- Create `.cfignore` — droplet trim.
- Create `docs/cf-deploy.md` — deploy flow.
- Create `packages/api/tests/test_main_entry.py` — entry-point + boot smoke.

---

## Task 1: Run-from-source entry, deps, manifest

**Files:** Create `packages/api/blogforge/__main__.py`, `runtime.txt`; Rename `requirements.lock`→`requirements.txt`; Modify `manifest.yml`, `packages/api/Dockerfile`; Test `packages/api/tests/test_main_entry.py`

- [ ] **Step 1: Write the failing test** `packages/api/tests/test_main_entry.py`:
```python
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

def test_blogforge_module_is_runnable() -> None:
    """`python -m blogforge --help` works with PYTHONPATH=packages/api (how CF runs it)."""
    env = {"PYTHONPATH": "packages/api", "PATH": "/usr/bin:/bin"}
    r = subprocess.run(
        [sys.executable, "-m", "blogforge", "--help"],
        cwd=REPO, env={**env}, capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    assert "serve" in r.stdout

def test_alembic_dir_resolves_from_source() -> None:
    """Running from source keeps alembic/ at parents[1] of server.py (no install needed)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bf_server_probe", REPO / "packages/api/blogforge/server.py"
    )
    assert spec and spec.origin
    alembic = Path(spec.origin).resolve().parents[1] / "alembic"
    assert alembic.is_dir()
```

- [ ] **Step 2: Run → FAIL** `.venv/bin/python -m pytest packages/api/tests/test_main_entry.py -q` (no `blogforge/__main__.py` → `python -m blogforge` errors "No module named blogforge.__main__").

- [ ] **Step 3: Create `packages/api/blogforge/__main__.py`:**
```python
"""Enable `python -m blogforge …` (CF runs from source; the console script isn't installed)."""
from blogforge.cli import main

main()
```

- [ ] **Step 4: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/test_main_entry.py -q` (2 passed).

- [ ] **Step 5: Consolidate deps to `requirements.txt`.**
```bash
cd /Users/dbbaskette/Projects/BlogForge
git mv requirements.lock requirements.txt
grep -nE "myvoice|^-e |@ file://|@ git\+" requirements.txt && echo "NOT pip-clean ^" || echo "pip-clean ✓"
```
Then in `packages/api/Dockerfile`, replace every `requirements.lock` with `requirements.txt` (the `COPY … requirements.lock …` line, the `uv pip install --system -r requirements.lock` line, and any comment). Verify: `grep -n requirements packages/api/Dockerfile` shows only `requirements.txt`.

- [ ] **Step 6: Create `runtime.txt`** (repo root). Pick the latest 3.11 the python_buildpack ships (check https://github.com/cloudfoundry/python-buildpack/releases or the foundation; `python-3.11.9` is widely supported):
```
python-3.11.9
```

- [ ] **Step 7: Edit `manifest.yml`** — change the start command and add env. Replace:
```yaml
    command: blogforge serve --host 0.0.0.0 --port $PORT
```
with:
```yaml
    command: python -m blogforge serve --host 0.0.0.0 --port $PORT --no-browser
```
and under `env:` add (alongside the existing vars-driven keys):
```yaml
      PYTHONPATH: packages/api
      BLOGFORGE_COOKIE_SECURE: "true"
```

- [ ] **Step 8: Boot smoke (how CF will run it).** Confirm the app boots from source, runs migrations, and answers health — no install, no static needed:
```bash
cd /Users/dbbaskette/Projects/BlogForge
rm -f .cf-smoke.db
PYTHONPATH=packages/api \
  BLOGFORGE_DATABASE_URL="sqlite+aiosqlite:///./.cf-smoke.db" \
  BLOGFORGE_RUN_MIGRATIONS_ON_BOOT=true \
  BLOGFORGE_S3_BOOTSTRAP_ON_BOOT=false \
  .venv/bin/python -m blogforge serve --host 127.0.0.1 --port 7899 --no-browser &
SVR=$!; sleep 6
curl -fsS -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:7899/api/health || echo "health FAILED"
kill $SVR 2>/dev/null; rm -f .cf-smoke.db
```
Expected: `health: 200`. (If the health path differs, find it: `grep -rn '\"/api/health\"\|/health' packages/api/blogforge/api packages/api/blogforge/server.py` and use the real one.)

- [ ] **Step 9: Full suite green** `.venv/bin/python -m pytest packages/api -q` (only new code is `__main__.py`).

- [ ] **Step 10: Commit**
```bash
git add packages/api/blogforge/__main__.py runtime.txt requirements.txt packages/api/Dockerfile manifest.yml packages/api/tests/test_main_entry.py
git commit -m "feat(cf): run-from-source entry (python -m blogforge), requirements.txt + runtime.txt, manifest command"
```

---

## Task 2: Web-bundle staging, .cfignore, deploy docs

**Files:** Create `scripts/cf-prepare.sh`, `.cfignore`, `docs/cf-deploy.md`

- [ ] **Step 1: Create `scripts/cf-prepare.sh`:**
```bash
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
```
Then `chmod +x scripts/cf-prepare.sh`.

- [ ] **Step 2: Run it + verify the bundle staged:**
```bash
cd /Users/dbbaskette/Projects/BlogForge
./scripts/cf-prepare.sh
test -f packages/api/blogforge/static/index.html && echo "static/index.html present ✓" || echo "MISSING static ✗"
```
Expected: builds, then `static/index.html present ✓`.

- [ ] **Step 3: Full SPA smoke (boot + serve the staged bundle):**
```bash
cd /Users/dbbaskette/Projects/BlogForge
rm -f .cf-smoke.db
PYTHONPATH=packages/api \
  BLOGFORGE_DATABASE_URL="sqlite+aiosqlite:///./.cf-smoke.db" \
  BLOGFORGE_RUN_MIGRATIONS_ON_BOOT=true BLOGFORGE_S3_BOOTSTRAP_ON_BOOT=false \
  .venv/bin/python -m blogforge serve --host 127.0.0.1 --port 7899 --no-browser &
SVR=$!; sleep 6
curl -fsS -o /dev/null -w "GET / : %{http_code}\n" http://127.0.0.1:7899/ || echo "root FAILED"
kill $SVR 2>/dev/null; rm -f .cf-smoke.db
```
Expected: `GET / : 200` (the SPA index is served from the staged `static/`).

- [ ] **Step 4: Create `.cfignore`** (repo root):
```
.git
.venv
local-venv
node_modules
**/node_modules
packages/web
local-data
docs
**/__pycache__
.pytest_cache
.ruff_cache
**/tests
*.db
vars.yml
vars-*.yml
.cf-smoke.db
```

- [ ] **Step 5: Verify `.cfignore` keeps the essentials.** The staged bundle and app must survive the ignore rules:
```bash
cd /Users/dbbaskette/Projects/BlogForge
git check-ignore packages/api/blogforge/static/index.html && echo "WARN static ignored ✗" || echo "static kept ✓"
for p in packages/api/blogforge/server.py requirements.txt runtime.txt manifest.yml pyproject.toml; do
  git check-ignore "$p" >/dev/null 2>&1 && echo "WARN $p ignored ✗" || echo "$p kept ✓"
done
```
> Note: `.cfignore` governs `cf push`, not git. `git check-ignore` here is only a proxy sanity check using the same patterns; `static/` is in `.gitignore` but **must not** be in `.cfignore` (it isn't — we exclude `packages/web`, not `packages/api/.../static`). If the first line warns, a pattern is over-broad — fix it.

- [ ] **Step 6: Create `docs/cf-deploy.md`:**
```markdown
# Deploying BlogForge to Tanzu Platform (cf push)

Pure `cf push` with the python_buildpack — no Docker, no external dependency.

## One-time
1. `cp vars.example.yml vars.yml` and fill it (`app_name`, `apps_domain`, `admin_email`, `github_allowlist`, `github_admin_login`).
2. Register a GitHub OAuth App with callback `https://<app_name>.<apps_domain>/api/auth/github/callback` — see `docs/github-oauth-setup.md`.
3. Ensure bound services exist: `cf services` should list `blogforge-postgres` and `blogforge-s3` (else `cf create-service …`).

## Each deploy
```bash
./scripts/cf-prepare.sh                 # build web bundle -> blogforge/static
cf push --vars-file vars.yml            # buildpack installs requirements.txt; runs python -m blogforge from source
```

## Secrets (once; persist across pushes)
```bash
cf set-env <app_name> BLOGFORGE_GITHUB_CLIENT_ID     <client-id>
cf set-env <app_name> BLOGFORGE_GITHUB_CLIENT_SECRET <client-secret>
cf set-env <app_name> BLOGFORGE_SESSION_SECRET       "$(openssl rand -hex 32)"
cf restage <app_name>
```

## Verify
Visit `https://<app_name>.<apps_domain>` → **Sign in with GitHub**. The admin login (`github_admin_login`) lands as admin. `RUN_MIGRATIONS_ON_BOOT=true` applies migrations on first boot.

## Notes
- The app runs from source (`PYTHONPATH=packages/api`, `python -m blogforge serve`) so Alembic's source-relative migration path resolves without installing the package.
- `requirements.txt` is the single pinned-deps file (also used by the Dockerfile).
- A fresh `blogforge-postgres` starts empty — your local content isn't migrated automatically.
```

- [ ] **Step 7: Commit**
```bash
git add scripts/cf-prepare.sh .cfignore docs/cf-deploy.md
git commit -m "feat(cf): cf-prepare web staging, .cfignore, deploy docs"
```

---

## Self-Review Notes
- **Spec coverage:** `__main__` + manifest run-from-source → T1; requirements.txt/runtime.txt → T1; Dockerfile unified → T1; cf-prepare web staging → T2; `.cfignore` → T2; docs → T2; both smokes (health + SPA) → T1/T2.
- **Placeholder check:** `runtime.txt` version is a concrete `python-3.11.9` with a note to match the buildpack; not a placeholder.
- **Consistency:** the entry is `python -m blogforge serve --host 0.0.0.0 --port $PORT --no-browser` in both the manifest (T1/Step 7) and the smokes (T1/Step 8, T2/Step 3); `PYTHONPATH=packages/api` everywhere; `requirements.txt` referenced consistently after the rename.
- **Adapt-on-contact:** the real health route (T1/Step 8) and the buildpack-supported Python patch (T1/Step 6).
```
