# Deploying BlogForge to Tanzu Platform (cf push)

Pure `cf push` with the python_buildpack — no Docker, no external dependency.

## One-time
1. Register a GitHub OAuth App with callback `https://<app_name>.<apps_domain>/api/auth/github/callback` — see [github-oauth-setup.md](github-oauth-setup.md).
2. `cp vars.example.yml vars.yml` and fill **everything**, including the secrets at the bottom:
   - non-secret: `app_name`, `apps_domain`, `admin_email`, `github_allowlist`, `github_admin_login`
   - secret: `github_client_id`, `github_client_secret`, `session_secret` (`openssl rand -hex 32`)
   `vars.yml` is gitignored — keep real secrets in it and **never commit it**.
3. Ensure bound services exist: `cf services` should list `blogforge-postgres` and `blogforge-blobs` (else `cf create-service …`). `blogforge-blobs` is a **Block Storage volume** service (`cf marketplace` for the offering + plan) — it mounts a persistent dir into the container, which the app uses as its blob store (`config/tanzu._apply_volume` → `BLOGFORGE_STORAGE_BACKEND=fs`, `BLOGFORGE_STORAGE_DIR=<mount>/blobs`). Object storage (SeaweedFS `blogforge-s3`) still works as a fallback if you bind it instead.
4. Ensure a `blogforge-ai` GenAI service instance exists and is bound — create it on the `ai-models` offering's `tanzu-all-models` plan: `cf create-service ai-models tanzu-all-models blogforge-ai` (it auto-populates `BLOGFORGE_TANZU_API_BASE/KEY`). To change the offered models: `cf set-env <app_name> BLOGFORGE_TANZU_MODELS "<comma,separated,model,ids>"`.

## Each deploy
```bash
./scripts/cf-prepare.sh                 # build web bundle -> blogforge/static
cf push --vars-file vars.yml            # carries all config + secrets; runs `python -m blogforge` from source
```

> Secrets live in `vars.yml` (gitignored) and are interpolated into the manifest at push time. This keeps them out of git, but note they appear in the rendered manifest, so avoid sharing `cf push` output/logs. For stronger handling, bind a CredHub-backed service instead.

## Verify
Visit `https://<app_name>.<apps_domain>` → **Sign in with GitHub**. The admin login (`github_admin_login`) lands as admin. `RUN_MIGRATIONS_ON_BOOT=true` applies migrations on first boot.

## Notes
- The app runs **from source** (`PYTHONPATH=packages/api`, `python -m blogforge serve`) so Alembic's source-relative migration path resolves without installing the package.
- `requirements.txt` is the single pinned-deps file (also used by the Dockerfile). Regenerate after dependency changes with `uv export --frozen --no-emit-project --no-dev --no-hashes -o requirements.txt`.
- `runtime.txt` pins the Python version; bump it to a python_buildpack-supported 3.11.x as needed.
- A fresh `blogforge-postgres` starts empty — your local content isn't migrated automatically.
- A fresh `blogforge-blobs` volume starts empty too — blobs (hero images, voice samples) aren't migrated from a previous SeaweedFS instance automatically.
