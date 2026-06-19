# Deploying BlogForge to Tanzu Platform (cf push)

Pure `cf push` with the python_buildpack — no Docker, no external dependency.

## One-time
1. `cp vars.example.yml vars.yml` and fill it (`app_name`, `apps_domain`, `admin_email`, `github_allowlist`, `github_admin_login`).
2. Register a GitHub OAuth App with callback `https://<app_name>.<apps_domain>/api/auth/github/callback` — see [github-oauth-setup.md](github-oauth-setup.md).
3. Ensure bound services exist: `cf services` should list `blogforge-postgres` and `blogforge-s3` (else `cf create-service …`).

## Each deploy
```bash
./scripts/cf-prepare.sh                 # build web bundle -> blogforge/static
cf push --vars-file vars.yml            # buildpack installs requirements.txt; runs `python -m blogforge` from source
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
- The app runs **from source** (`PYTHONPATH=packages/api`, `python -m blogforge serve`) so Alembic's source-relative migration path resolves without installing the package.
- `requirements.txt` is the single pinned-deps file (also used by the Dockerfile). Regenerate after dependency changes with `uv export --frozen --no-emit-project --no-dev --no-hashes -o requirements.txt`.
- `runtime.txt` pins the Python version; bump it to a python_buildpack-supported 3.11.x as needed.
- A fresh `blogforge-postgres` starts empty — your local content isn't migrated automatically.
