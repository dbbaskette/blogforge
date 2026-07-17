# Home services production deployment

BlogForge production runs natively on `home-services.local` and is published at
`https://blogforge.baskettecase.com` through the existing Cloudflare tunnel.
The application is supervised by launchd and stores its data outside the Git checkout.

## Production layout

| Item | Value |
|---|---|
| SSH alias | `blogforge-home` |
| Account | `dbbaskette@home-services.local` |
| Repository | `/Users/dbbaskette/Projects/blogforge` |
| LaunchAgent | `com.baskettecase.blogforge` |
| Internal service | `http://127.0.0.1:7880` |
| Public service | `https://blogforge.baskettecase.com` |
| Data and logs | `/Users/dbbaskette/.blogforge` |
| Production environment | repository-local `.env.public` (gitignored) |

Deployments update only tracked source through Git. They do not copy the local
checkout, modify `.env.public`, delete untracked files, or touch production data.
Cloudflare routing and DNS are already configured and are not part of this workflow.

## One-time SSH setup

The dedicated Ed25519 key is stored locally as
`~/.ssh/blogforge_home_services` with public key
`~/.ssh/blogforge_home_services.pub`. Its expected fingerprint is:

```text
SHA256:IUngXsi8dGUEQfZzSxZ2IVBEYkkN6sqCSX3Ysi8nuOc
```

Verify and install the public key on a new workstation:

```bash
ssh-keygen -lf ~/.ssh/blogforge_home_services.pub
ssh-copy-id -i ~/.ssh/blogforge_home_services.pub dbbaskette@home-services.local
```

Add this block to `~/.ssh/config` and set its mode to 600:

```sshconfig
Host blogforge-home
  HostName home-services.local
  User dbbaskette
  IdentityFile ~/.ssh/blogforge_home_services
  IdentitiesOnly yes
```

Verify resolution and non-interactive authentication:

```bash
ssh -G blogforge-home | grep -E '^(hostname|user|identityfile) '
ssh -o BatchMode=yes -o ConnectTimeout=10 blogforge-home true
```

Never commit either key file or `~/.ssh/config`.

## Normal deployment

Production accepts only reviewed commits already merged into `origin/main`:

```bash
git checkout main
git pull --ff-only
scripts/deploy-home.sh
```

Every new production SHA must carry a semantic version greater than the
currently deployed checkout. Use `scripts/version.sh patch` for a bug fix and
`scripts/version.sh minor` or `major` when appropriate, then commit both version
files with the change. Redeploying the exact same SHA for recovery is allowed
without another bump.

The script refuses non-`main` branches, tracked local changes, local commits
that differ from `origin/main`, missing SSH authentication, tracked remote
changes, divergent remote history, a new SHA without a greater version, and a
resulting SHA other than the intended commit. Version rejection happens before
the remote checkout is changed. The script ignores untracked files rather than
transferring or removing them.

On success, the remote fast-forwards its own checkout and runs
`scripts/redeploy.sh --sync`. That synchronizes dependencies, rebuilds and
stages the web bundle, restarts launchd, and verifies the application version.
The wrapper then verifies internal and public health and prints the prior SHA,
deployed SHA, version, and both health responses.

## Status and logs

```bash
ssh blogforge-home \
  'cd /Users/dbbaskette/Projects/blogforge && git status --short && git log -1 --oneline && scripts/version.sh'
ssh blogforge-home 'launchctl print gui/$(id -u)/com.baskettecase.blogforge'
ssh blogforge-home 'tail -100 ~/.blogforge/serve.log'
ssh blogforge-home 'curl -fsS http://127.0.0.1:7880/api/health'
curl -fsS https://blogforge.baskettecase.com/api/health
```

## Explicit rollback

Choose a historical commit reachable from `origin/main`:

```bash
scripts/rollback-home.sh <commit>
```

The script asks you to type the exact word `rollback`. For reviewed automation:

```bash
scripts/rollback-home.sh --yes <commit>
```

Rollback fetches `origin/main`, rejects revisions outside its history, checks
out the selected commit in detached-HEAD state, runs `redeploy.sh --sync`, and
verifies internal and public health. It never moves or rewrites remote `main`.
The next normal deployment returns the checkout to `main`, fast-forwards it,
and deploys the current release.

## Failure recovery

The scripts never silently reset or roll back. A failed attempted release
remains checked out for diagnosis.

1. Inspect the reported prior and attempted SHAs.
2. Inspect launchd and recent logs:

   ```bash
   ssh blogforge-home 'launchctl print gui/$(id -u)/com.baskettecase.blogforge'
   ssh blogforge-home 'tail -100 ~/.blogforge/serve.log'
   ```

3. Reproduce a failed deployment step when necessary:

   ```bash
   ssh blogforge-home
   cd /Users/dbbaskette/Projects/blogforge
   scripts/redeploy.sh --sync
   ```

4. Fix forward on `main`, or explicitly roll back to a known good commit.

If Git reports tracked remote modifications, inspect and preserve them before
continuing. Never use `git reset --hard` or `git clean`. The known untracked
`.python-version`, `.env.public`, and everything under `~/.blogforge` must remain untouched.

## Security boundaries

- Source comes from remote Git history, never rsync/SCP.
- Feature branches and unpushed commits cannot deploy.
- SSH uses the dedicated key and non-interactive authentication.
- Script output never reads or prints `.env.public` or private-key material.
- Health requests use bounded timeouts.
- Cloudflare, DNS, OAuth, launchd definitions, and production data are outside this workflow.
