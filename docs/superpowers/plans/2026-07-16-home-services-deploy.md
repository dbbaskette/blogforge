# Home Services SSH Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe local deploy and rollback scripts that update the launchd-supervised BlogForge production host from `origin/main` over the dedicated SSH key.

**Architecture:** Local scripts enforce branch, cleanliness, and origin parity before invoking a purpose-built remote shell program over the `blogforge-home` SSH alias. The remote program allows only clean fast-forward updates from `origin/main`, delegates build/restart/version verification to the existing `scripts/redeploy.sh --sync`, and leaves untracked production configuration and data untouched.

**Tech Stack:** Bash, Git, OpenSSH, launchd, curl, pytest subprocess tests.

## Global Constraints

- Production source is only commits merged into `origin/main`.
- Transport is SSH plus remote `git fetch`/`git merge --ff-only`; never rsync or SCP source files.
- Never run `git reset --hard`, `git clean`, or delete untracked remote files.
- Never print `.env.public`, authentication tokens, OAuth secrets, session secrets, or private-key contents.
- Normal deploys require local `main`, clean tracked files, and `HEAD == origin/main`.
- Remote tracked changes and divergent history block deployment before restart.
- Every production deploy runs `scripts/redeploy.sh --sync`.
- Rollback accepts only commits reachable from `origin/main`, uses detached HEAD, and requires explicit confirmation unless `--yes` is given.
- Automated tests must never connect to `home-services.local`.
- Production deployment itself is out of scope until these changes are merged into `origin/main` and explicitly authorized.

---

## File map

- `scripts/deploy-home.sh`: local deployment preflight, remote fast-forward/redeploy program, and public verification.
- `scripts/rollback-home.sh`: local confirmation, remote revision validation/detached checkout/redeploy, and public verification.
- `packages/api/tests/test_home_deploy_scripts.py`: real-script subprocess tests using fake commands and temporary repositories.
- `docs/home-services-deploy.md`: key bootstrap, deployment, inspection, rollback, and failure recovery runbook.
- `README.md`: short pointer to the production runbook.
- `~/.ssh/config`: idempotent local alias configuration; private and public key files remain outside Git.

### Task 1: Normal deployment script

**Files:**
- Create: `scripts/deploy-home.sh`
- Create: `packages/api/tests/test_home_deploy_scripts.py`

**Interfaces:**
- Produces: `scripts/deploy-home.sh` with no positional arguments.
- Environment overrides for tests: `BLOGFORGE_DEPLOY_HOST` (default `blogforge-home`), `BLOGFORGE_REMOTE_DIR` (default `/Users/dbbaskette/Projects/blogforge`), `BLOGFORGE_SSH` (default `ssh`), and `BLOGFORGE_CURL` (default `curl`).
- Remote stdout protocol: final tab-separated line `BLOGFORGE_DEPLOY_RESULT<TAB>previous_sha<TAB>deployed_sha<TAB>version<TAB>internal_health_json`.

- [ ] **Step 1: Write failing local-preflight tests**

Create helpers that copy the actual script into a temporary Git repository, create a bare `origin`, and execute it with fake `ssh` and `curl` binaries prepended to `PATH`. Add tests asserting:

```python
assert result.returncode != 0
assert "requires local branch main" in result.stderr
assert "tracked local changes" in result.stderr
assert "does not match origin/main" in result.stderr
```

The non-main test checks out `feature`; the dirty test changes a tracked file; the origin-parity test commits locally without pushing. Assert the fake SSH invocation log remains empty in every failed preflight.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_home_deploy_scripts.py -k 'branch or dirty or origin' -v
```

Expected: FAIL because `scripts/deploy-home.sh` does not exist.

- [ ] **Step 3: Implement local preflight**

Create an executable Bash script with `set -euo pipefail`, repository-root discovery, and defaults:

```bash
DEPLOY_HOST="${BLOGFORGE_DEPLOY_HOST:-blogforge-home}"
REMOTE_DIR="${BLOGFORGE_REMOTE_DIR:-/Users/dbbaskette/Projects/blogforge}"
SSH_BIN="${BLOGFORGE_SSH:-ssh}"
CURL_BIN="${BLOGFORGE_CURL:-curl}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
```

Run `git fetch origin main`, require `git branch --show-current` equals `main`, require both `git diff --quiet` and `git diff --cached --quiet`, and require `git rev-parse HEAD` equals `git rev-parse origin/main`. Check the SSH alias with `ssh ... host true`. Do not inspect or reject untracked files.

- [ ] **Step 4: Write failing remote-command tests**

The fake SSH executable must capture stdin to a file and return controlled output. Assert the transmitted remote program contains:

```text
git diff --quiet
git diff --cached --quiet
git fetch origin main
git merge-base --is-ancestor
git merge --ff-only origin/main
scripts/redeploy.sh --sync
http://127.0.0.1:7880/api/health
```

Assert it does not contain `reset --hard`, `git clean`, `rm`, `.env.public`, or private-key content. Add tests where fake SSH reports dirty/divergent/build failure and ensure the local script exits nonzero without attempting public curl.

- [ ] **Step 5: Implement remote update and result parsing**

Send a single quoted Bash program on stdin with positional parameters for `REMOTE_DIR` and intended SHA; do not interpolate untrusted values into shell source. The remote program:

```bash
set -euo pipefail
cd "$1"
previous_sha="$(git rev-parse HEAD)"
if [ -n "$(git branch --show-current)" ] && [ "$(git branch --show-current)" != main ]; then
  echo "remote checkout must be main or detached rollback" >&2
  exit 1
fi
git diff --quiet || { echo "tracked remote changes" >&2; exit 1; }
git diff --cached --quiet || { echo "tracked remote changes" >&2; exit 1; }
git fetch origin main
git merge-base --is-ancestor "$previous_sha" origin/main || {
  echo "remote history is not fast-forwardable" >&2
  exit 1
}
git checkout main
git merge --ff-only origin/main
[ "$(git rev-parse HEAD)" = "$2" ] || { echo "remote SHA differs from intended SHA" >&2; exit 1; }
scripts/redeploy.sh --sync
version="$(scripts/version.sh)"
health="$(curl -fsS --max-time 10 http://127.0.0.1:7880/api/health)"
printf 'BLOGFORGE_DEPLOY_RESULT\t%s\t%s\t%s\t%s\n' \
  "$previous_sha" "$(git rev-parse HEAD)" "$version" "$health"
```

For detached rollback recovery, `git checkout main` must occur only after cleanliness and fast-forward checks; compare the previous commit to `origin/main` before returning to `main`.

Capture remote output, extract exactly one result line, and fail if it is absent or malformed. Run public verification with `curl -fsS --max-time 15 https://blogforge.baskettecase.com/api/health`, require both health documents contain the expected version, then print previous SHA, deployed SHA, version, internal health, and public health.

- [ ] **Step 6: Run focused tests and shell checks**

Run:

```bash
bash -n scripts/deploy-home.sh
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_home_deploy_scripts.py -k deploy -v
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run ruff check packages/api/tests/test_home_deploy_scripts.py
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/deploy-home.sh packages/api/tests/test_home_deploy_scripts.py
git commit -m "feat(deploy): add home services deploy script"
```

### Task 2: Explicit rollback script

**Files:**
- Create: `scripts/rollback-home.sh`
- Modify: `packages/api/tests/test_home_deploy_scripts.py`

**Interfaces:**
- Produces: `scripts/rollback-home.sh [--yes] <commit>`.
- Uses the same four environment overrides as the deploy script.
- Remote stdout protocol: final tab-separated line `BLOGFORGE_ROLLBACK_RESULT<TAB>previous_sha<TAB>rollback_sha<TAB>version<TAB>internal_health_json`.

- [ ] **Step 1: Write failing argument and confirmation tests**

Test missing/multiple commits return exit 2, unknown options return exit 2, and no remote call occurs without the operator entering the exact word `rollback`. Test `--yes` skips the prompt.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_home_deploy_scripts.py -k rollback -v
```

Expected: FAIL because `scripts/rollback-home.sh` does not exist.

- [ ] **Step 3: Implement rollback preflight and remote program**

Use strict mode and the same host/SSH/curl defaults. Validate exactly one revision, verify SSH connectivity, prompt:

```text
Type rollback to deploy <revision> to blogforge-home:
```

The remote program must:

```bash
set -euo pipefail
cd "$1"
git diff --quiet || { echo "tracked remote changes" >&2; exit 1; }
git diff --cached --quiet || { echo "tracked remote changes" >&2; exit 1; }
git fetch origin main
rollback_sha="$(git rev-parse --verify "$2^{commit}")"
git merge-base --is-ancestor "$rollback_sha" origin/main || {
  echo "rollback commit is not reachable from origin/main" >&2
  exit 1
}
previous_sha="$(git rev-parse HEAD)"
git checkout --detach "$rollback_sha"
scripts/redeploy.sh --sync
version="$(scripts/version.sh)"
health="$(curl -fsS --max-time 10 http://127.0.0.1:7880/api/health)"
printf 'BLOGFORGE_ROLLBACK_RESULT\t%s\t%s\t%s\t%s\n' \
  "$previous_sha" "$rollback_sha" "$version" "$health"
```

Pass the revision as a positional parameter, never shell interpolation. Parse the protocol line, run the public health check, require both health responses contain the reported version, and print the prior/rollback SHAs and health responses.

- [ ] **Step 4: Add remote rollback and recovery tests**

Cover unreachable revision refusal, dirty remote refusal, deploy failure propagation, public health failure, detached checkout command construction, and that the normal deploy program from Task 1 includes recovery from detached rollback state.

- [ ] **Step 5: Run focused verification**

Run:

```bash
bash -n scripts/deploy-home.sh scripts/rollback-home.sh
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_home_deploy_scripts.py -v
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run ruff check packages/api/tests/test_home_deploy_scripts.py
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/rollback-home.sh packages/api/tests/test_home_deploy_scripts.py
git commit -m "feat(deploy): add explicit home rollback"
```

### Task 3: SSH alias and production runbook

**Files:**
- Create: `docs/home-services-deploy.md`
- Modify: `README.md`
- External user config: `/Users/dbbaskette/.ssh/config`

**Interfaces:**
- Consumes: scripts from Tasks 1 and 2.
- Produces: SSH alias `blogforge-home` using `~/.ssh/blogforge_home_services`.

- [ ] **Step 1: Add the SSH alias idempotently**

Inspect `~/.ssh/config`. If the exact `Host blogforge-home` block is absent, append:

```sshconfig
Host blogforge-home
  HostName home-services.local
  User dbbaskette
  IdentityFile ~/.ssh/blogforge_home_services
  IdentitiesOnly yes
```

Set config mode 600. If an existing block differs, stop for user direction rather than duplicating or overwriting it. Verify:

```bash
ssh -G blogforge-home | grep -E '^(hostname|user|identityfile) '
ssh -o BatchMode=yes -o ConnectTimeout=10 blogforge-home true
```

Expected: resolved host/user/key match and connection exits 0.

- [ ] **Step 2: Write the runbook**

Create `docs/home-services-deploy.md` with:

- current architecture and paths;
- key filename and fingerprint, never key material;
- initial `ssh-copy-id` bootstrap;
- SSH config block;
- normal `main`-only deployment commands;
- explanation of all preflight checks;
- `curl` health, `ssh blogforge-home`, `launchctl print`, and `tail ~/.blogforge/serve.log` status commands;
- explicit rollback with and without `--yes`;
- next-deploy recovery from detached rollback;
- build/sync/restart/health failure recovery;
- production data and `.env.public` preservation;
- existing Cloudflare routing and why it is not modified; and
- the prohibition on deploying feature branches or copying source directly.

- [ ] **Step 3: Link the runbook from README**

Add a compact `Home services production` subsection near local-host deployment linking to `docs/home-services-deploy.md` and showing only:

```bash
git checkout main
git pull --ff-only
scripts/deploy-home.sh
```

- [ ] **Step 4: Verify documentation and script help**

Run:

```bash
scripts/deploy-home.sh --help
scripts/rollback-home.sh --help
rg -n "BEGIN .*PRIVATE KEY|BLOGFORGE_GITHUB_CLIENT_SECRET=|BLOGFORGE_SESSION_SECRET=" docs/home-services-deploy.md README.md scripts/deploy-home.sh scripts/rollback-home.sh
git diff --check
```

Expected: help exits 0; secret scan finds no values; diff check passes. Add `--help` handling to both scripts if Task 1 or 2 omitted it.

- [ ] **Step 5: Commit repository documentation**

```bash
git add docs/home-services-deploy.md README.md scripts/deploy-home.sh scripts/rollback-home.sh
git commit -m "docs(deploy): add home services runbook"
```

Do not commit `~/.ssh/config` or either key file.

### Task 4: Final verification without production mutation

**Files:**
- Modify only if verification finds a feature defect.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified scripts and a read-only production preflight record.

- [ ] **Step 1: Run all feature checks**

Run:

```bash
bash -n scripts/deploy-home.sh scripts/rollback-home.sh
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_home_deploy_scripts.py packages/api/tests/test_cli.py -v
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run ruff check packages/api/tests/test_home_deploy_scripts.py packages/api/tests/test_cli.py
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run broader regression checks**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_codex_cli.py packages/api/tests/test_default_provider.py -q
cd packages/web && pnpm test
cd packages/web && pnpm build
```

Expected: all pass, with only previously accepted frontend warnings.

- [ ] **Step 3: Verify the remote read-only**

Use SSH commands that do not fetch, merge, build, restart, or edit:

```bash
ssh -o BatchMode=yes blogforge-home 'cd /Users/dbbaskette/Projects/blogforge && git branch --show-current && git status --short && scripts/version.sh && curl -fsS http://127.0.0.1:7880/api/health'
curl -fsS https://blogforge.baskettecase.com/api/health
```

Expected: remote reports `main`, only the known untracked `.python-version`, version/health agree, and public health succeeds.

- [ ] **Step 4: Confirm no production deploy occurred**

Compare the remote SHA and launchd PID/start time with the values captured before implementation. The SHA may advance only through an independently authorized deployment; this plan itself does not deploy. Record the comparison in the implementation report.

- [ ] **Step 5: Review scope and secrets**

Run:

```bash
git status --short
git diff --stat main...HEAD
rg -n "BEGIN .*PRIVATE KEY|CODEX_ACCESS_TOKEN|CLAUDE_CODE_OAUTH_TOKEN=|BLOGFORGE_GITHUB_CLIENT_SECRET=|BLOGFORGE_SESSION_SECRET=" scripts docs README.md
```

Expected: only planned repository files changed, `.pnpm-store/` remains untouched/untracked in the original checkout, and no secret values appear.

## Completion criteria

- The dedicated SSH key authenticates through `blogforge-home`.
- Normal deployment refuses anything except clean, synchronized `main` and clean fast-forwardable remote state.
- Deployment uses remote Git and `redeploy.sh --sync`, not file copying.
- Explicit rollback accepts only commits reachable from `origin/main` and never rewrites `main`.
- Internal/public version and health verification are mandatory.
- Tests cover local/remote refusal paths, command construction, success, failure propagation, rollback, and detached recovery.
- Runbook and README document the supported production workflow.
- Final verification is read-only against production; no production deployment occurs during implementation.
