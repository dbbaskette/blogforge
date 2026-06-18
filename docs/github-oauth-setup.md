# GitHub OAuth Setup

Enable GitHub OAuth login so allowlisted GitHub users can sign in to BlogForge.

## 1. Register a GitHub OAuth App

1. Go to github.com → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Homepage URL**: the app's base URL (e.g. `http://localhost:7880` or `https://<app-route>`).
   - **Authorization callback URL**: `<base-url>/api/auth/github/callback`.
3. You can register two apps — one per environment (local + deployed) — or one app per environment.
4. After creating the app, copy the **Client ID** and click **Generate a new client secret** to get the **Client secret**.

## 2. Configure locally

Export these variables before running `./scripts/serve-host.sh` (port 7880) or `./scripts/run-local.sh` (port 7882):

```bash
export BLOGFORGE_GITHUB_CLIENT_ID=...
export BLOGFORGE_GITHUB_CLIENT_SECRET=...
export BLOGFORGE_GITHUB_ALLOWLIST=dbbaskette,teammate
export BLOGFORGE_GITHUB_ADMIN_LOGIN=dbbaskette
export BLOGFORGE_PUBLIC_URL=http://localhost:7880
```

The scripts default `BLOGFORGE_PUBLIC_URL` to their respective port (`7880` / `7882`) and `BLOGFORGE_GITHUB_ALLOWLIST` / `BLOGFORGE_GITHUB_ADMIN_LOGIN` to `dbbaskette`, so you only need to export the ones you want to override.

## 3. Configure on Cloud Foundry / Tanzu Platform

The non-secret keys (`BLOGFORGE_GITHUB_ALLOWLIST`, `BLOGFORGE_GITHUB_ADMIN_LOGIN`) are already in `manifest.yml`. Set the secrets and public URL via `cf set-env` — never commit them:

```bash
cf set-env blogforge BLOGFORGE_GITHUB_CLIENT_ID <client-id>
cf set-env blogforge BLOGFORGE_GITHUB_CLIENT_SECRET <client-secret>
cf set-env blogforge BLOGFORGE_PUBLIC_URL https://<app-route>
cf set-env blogforge BLOGFORGE_GITHUB_ALLOWLIST dbbaskette,teammate
cf set-env blogforge BLOGFORGE_GITHUB_ADMIN_LOGIN dbbaskette
cf restage blogforge
```

## 4. How access works

- Only GitHub logins listed in `BLOGFORGE_GITHUB_ALLOWLIST` (comma-separated) may sign in. Any other login is rejected with a 403.
- The login named in `BLOGFORGE_GITHUB_ADMIN_LOGIN` is the admin. On their first OAuth sign-in, they adopt the existing admin account — inheriting its drafts and voice profile — so nothing is lost.
- Other allowlisted logins receive a new, approved (non-admin) account on first sign-in.
