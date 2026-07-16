# Home Services SSH Deployment Design

**Date:** 2026-07-16

## Goal

Provide a safe, repeatable way to deploy BlogForge from this Mac to the existing production instance on `home-services.local` over SSH. Production must run only code already merged into `origin/main`; GitHub remains the source of deployable code, and no application source or secrets are copied directly from the developer checkout.

## Current deployment

The production host is `home-services.local`, reached as user `dbbaskette`. It is an Intel macOS host running BlogForge natively from `/Users/dbbaskette/Projects/blogforge` under the launchd agent `com.baskettecase.blogforge`.

The current service:

- listens on port 7880;
- returns healthy responses locally and through `https://blogforge.baskettecase.com`;
- stores SQLite data and filesystem blobs under `/Users/dbbaskette/.blogforge`, outside the Git checkout;
- loads production configuration and secrets from the gitignored `.env.public`;
- uses the repository's existing `scripts/redeploy.sh` to build the web bundle, optionally synchronize dependencies, restart launchd, and verify the application version; and
- has Codex CLI, Claude CLI, `uv`, `pnpm`, Node, Git, and curl installed.

The remote repository is on `main` and tracks `origin/main`. An untracked `.python-version` exists and must remain untouched.

Cloudflare already routes `blogforge.baskettecase.com` to this service and currently returns HTTP 200. This feature does not alter Cloudflare, DNS, OAuth, or tunnel configuration.

## SSH authentication

Use a dedicated Ed25519 key:

- private key: `~/.ssh/blogforge_home_services`
- public key: `~/.ssh/blogforge_home_services.pub`
- fingerprint: `SHA256:IUngXsi8dGUEQfZzSxZ2IVBEYkkN6sqCSX3Ysi8nuOc`
- remote authorized account: `dbbaskette@home-services.local`

Private-key material never enters the repository. The public key is installed in the remote user's `~/.ssh/authorized_keys`.

Add this idempotent host entry to the local `~/.ssh/config`:

```sshconfig
Host blogforge-home
  HostName home-services.local
  User dbbaskette
  IdentityFile ~/.ssh/blogforge_home_services
  IdentitiesOnly yes
```

Scripts use the `blogforge-home` alias. They must still support test-time SSH command substitution without connecting to the real host.

## Normal deployment

Add `scripts/deploy-home.sh`. Its only supported production source is the developer's local `main` branch when it exactly matches `origin/main`.

### Local preflight

Before any remote mutation, the script:

1. enters the repository root;
2. verifies the current branch is `main`;
3. verifies there are no tracked local modifications, staged or unstaged;
4. runs `git fetch origin main`;
5. verifies local `HEAD` exactly equals `origin/main`;
6. verifies the dedicated SSH key exists; and
7. verifies non-interactive SSH connectivity through `blogforge-home`.

Untracked local files do not block deployment. They are never transferred to production.

### Remote preflight and update

The remote portion runs in `/Users/dbbaskette/Projects/blogforge` with strict shell mode. It:

1. records the current remote SHA as the rollback reference;
2. verifies the current remote branch is `main` or restores `main` from a prior detached rollback;
3. verifies there are no tracked remote modifications, staged or unstaged;
4. runs `git fetch origin main`;
5. verifies the current remote commit is an ancestor of `origin/main`, preventing non-fast-forward replacement;
6. updates through `git merge --ff-only origin/main`; and
7. runs `scripts/redeploy.sh --sync`.

The update never runs `git reset --hard`, `git clean`, or deletion commands. Untracked `.python-version`, `.env.public`, production data, logs, and other untracked or ignored files remain untouched.

Using `--sync` on every production deploy is intentional: it makes dependency changes safe without requiring the caller to infer whether `uv.lock` changed. The existing redeploy script always rebuilds and stages the web bundle before restarting launchd.

### Verification

After redeploy succeeds, the local deploy script verifies:

- `http://127.0.0.1:7880/api/health` from the production host;
- `https://blogforge.baskettecase.com/api/health` from the developer machine;
- the running application version matches `packages/web/package.json`; and
- the remote checkout SHA matches the intended local `origin/main` SHA.

Successful output ends with the deployed SHA, application version, internal health response, and public health response.

## Failure behavior

All scripts use strict shell mode, bounded SSH/curl timeouts, and actionable errors.

- A failed local preflight causes no remote mutation.
- A dirty remote tracked tree stops before fetch/merge/restart.
- A divergent remote checkout stops before deployment.
- A fetch or fast-forward failure stops without restarting the service.
- A dependency, build, restart, or health failure reports the previous SHA, attempted SHA, and commands for inspecting `~/.blogforge/serve.log` and launchd state.
- A failed deployment leaves the checkout at the attempted commit for diagnosis. It does not silently roll back or reset production.

Deployment scripts must never print `.env.public`, authentication tokens, GitHub OAuth credentials, session secrets, or private-key contents.

## Explicit rollback

Add `scripts/rollback-home.sh <commit>` for deliberate recovery.

Before changing production it:

1. requires exactly one commit argument;
2. verifies the dedicated key and SSH connectivity;
3. asks the operator to type `rollback` unless `--yes` is supplied;
4. verifies the remote tracked tree is clean;
5. fetches `origin/main`;
6. resolves the requested revision to a commit; and
7. verifies the commit is reachable from `origin/main`.

The remote then checks out that commit in detached-HEAD state and runs `scripts/redeploy.sh --sync`. The script performs the same internal and public health checks as a normal deployment and reports the prior and rollback SHAs.

Rollback never rewrites `main`. The next normal deployment detects detached HEAD, checks out `main`, verifies it remains clean and fast-forwardable, merges `origin/main`, and redeploys the current production release.

## Files and documentation

Repository changes:

- create `scripts/deploy-home.sh`;
- create `scripts/rollback-home.sh`;
- add focused shell-script tests under `packages/api/tests` using fake `ssh`, `git`, and `curl` commands;
- create `docs/home-services-deploy.md`; and
- update the README with a short link to the home-services runbook if useful.

The runbook documents:

- one-time SSH key bootstrap and fingerprint verification;
- the `blogforge-home` SSH config entry;
- normal deployment;
- status, health, logs, and launchd inspection;
- explicit rollback;
- recovery from failed dependency sync, build, restart, or health verification; and
- the fact that Cloudflare is already configured and outside this workflow.

## Testing

Tests execute the actual scripts with controlled fake commands and temporary repositories. They cover:

- refusal from a non-`main` branch;
- refusal when tracked local changes exist;
- refusal when local `HEAD` differs from `origin/main`;
- SSH/key preflight failure;
- correct remote command construction;
- preservation of untracked files;
- dirty and divergent remote refusal;
- successful fast-forward, redeploy, version, and health verification;
- propagation of remote build/restart/health failures;
- rollback confirmation;
- rollback rejection for commits not reachable from `origin/main`;
- detached rollback checkout and redeploy; and
- recovery from detached rollback state during the next normal deployment.

No automated test connects to `home-services.local`. A final controlled smoke test may run the deployment script only when `origin/main` already contains the implementation and the operator explicitly authorizes the production deployment.

## Out of scope

- Automatic deployment from GitHub Actions.
- Direct `rsync` or SCP of the developer checkout.
- Deploying feature branches or unpushed commits.
- Editing production secrets or `.env.public`.
- Changing Cloudflare, DNS, OAuth, launchd service definition, or production data.
- Silent automatic rollback.
