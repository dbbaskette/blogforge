# Version Increment Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the Codex-provider hotfix as `0.7.1` and prevent future deployable changes from reusing an existing semantic version.

**Architecture:** `scripts/version.sh` owns strict three-component semantic-version comparison. A new PR check classifies changed paths conservatively and uses that comparison against the base revision, while `scripts/deploy-home.sh` applies the same comparison to the production checkout before fast-forwarding it. Tests exercise the shell interfaces through temporary Git repositories and the existing fake SSH deployment harness.

**Tech Stack:** Bash, Git, Node.js, Python/pytest, GitHub Actions, pnpm/Vite, FastAPI health endpoint

## Global Constraints

- Every non-exempt change must increase `x.y.z` by at least a patch; minor and major increases also qualify.
- Equal, lower, or malformed versions fail.
- `packages/web/package.json` and `packages/api/blogforge/__init__.py` must remain synchronized.
- Documentation-, test-, CI-, assistant-metadata-, screenshot-, and design-preview-only changes are exempt exactly as listed in the approved spec.
- Unknown paths require a bump.
- Deploying a different SHA requires a greater version; redeploying the same SHA is allowed.
- Rollback behavior does not change.
- The corrective release version is `0.7.1`.

---

## File Structure

- `scripts/version.sh`: canonical version read/bump/synchronization command plus strict semantic comparison.
- `scripts/check-version-bump.sh`: Git-diff classification and base-versus-head PR validation.
- `.github/workflows/version-check.yml`: invokes the PR validator with the pull request base SHA.
- `scripts/deploy-home.sh`: production preflight that rejects a different SHA without a newer version before checkout mutation.
- `packages/api/tests/test_version_scripts.py`: focused unit/integration tests for comparison and PR path classification.
- `packages/api/tests/test_home_deploy_scripts.py`: fake-SSH coverage for production version gating and same-SHA recovery.
- `packages/web/package.json` and `packages/api/blogforge/__init__.py`: synchronized `0.7.1` release identity.
- `docs/home-services-deploy.md`: operator-facing version requirement and failure recovery.

### Task 1: Strict semantic-version comparison

**Files:**
- Modify: `scripts/version.sh`
- Create: `packages/api/tests/test_version_scripts.py`

**Interfaces:**
- Produces: `scripts/version.sh compare <baseline> <candidate>`; exit `0` only when `candidate` is a valid three-component semantic version strictly greater than `baseline`.

- [ ] **Step 1: Write failing comparison tests**

Create a parameterized pytest test that invokes `/bin/bash scripts/version.sh compare BASE CANDIDATE` and asserts:

```python
@pytest.mark.parametrize(
    ("baseline", "candidate"),
    [("0.7.0", "0.7.1"), ("0.7.9", "0.8.0"), ("0.99.99", "1.0.0")],
)
def test_compare_accepts_strict_increase(baseline: str, candidate: str) -> None:
    result = _version("compare", baseline, candidate)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("baseline", "candidate"),
    [("0.7.0", "0.7.0"), ("0.7.1", "0.7.0"), ("0.7", "0.7.1"), ("0.7.0", "next")],
)
def test_compare_rejects_nonincrease_or_malformed(
    baseline: str, candidate: str
) -> None:
    result = _version("compare", baseline, candidate)
    assert result.returncode != 0
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `uv run pytest packages/api/tests/test_version_scripts.py -q`

Expected: FAIL because `compare` is not a supported operation.

- [ ] **Step 3: Implement numeric comparison before repository-dependent reads**

Add an early `compare` branch in `scripts/version.sh` before `cd` and `web_version` are evaluated. Validate both arguments with `^[0-9]+\.[0-9]+\.[0-9]+$`, split them into numeric components, and compare major, minor, then patch using base-10 arithmetic (`10#$component`). Print a useful rejection such as `candidate version 0.7.0 must be greater than 0.7.0`.

- [ ] **Step 4: Run focused tests and shell syntax**

Run:

```bash
uv run pytest packages/api/tests/test_version_scripts.py -q
bash -n scripts/version.sh
```

Expected: all tests pass and shell syntax exits `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/version.sh packages/api/tests/test_version_scripts.py
git commit -m "feat(release): add strict semver comparison"
```

### Task 2: Pull-request version validation

**Files:**
- Create: `scripts/check-version-bump.sh`
- Modify: `packages/api/tests/test_version_scripts.py`
- Create: `.github/workflows/version-check.yml`

**Interfaces:**
- Consumes: `scripts/version.sh compare <baseline> <candidate>`.
- Produces: `scripts/check-version-bump.sh <base-ref>`; exit `0` for an exempt-only diff or a synchronized, strictly newer candidate; nonzero otherwise.

- [ ] **Step 1: Add failing temporary-repository tests**

Build a pytest fixture containing the two version files, copies of both scripts, and a base commit. Add tests that commit changed files and invoke the checker against the saved base SHA:

```python
def test_runtime_change_requires_newer_version(version_repo) -> None:
    repo, base = version_repo
    _commit_file(repo, "packages/api/blogforge/server.py", "changed\n")
    result = _check(repo, base)
    assert result.returncode != 0
    assert "must be greater" in result.stderr


@pytest.mark.parametrize(
    "path",
    ["docs/note.md", "README.md", "packages/api/tests/test_only.py", ".github/workflows/test.yml"],
)
def test_exempt_only_change_does_not_require_bump(version_repo, path: str) -> None:
    repo, base = version_repo
    _commit_file(repo, path, "changed\n")
    assert _check(repo, base).returncode == 0


def test_unknown_path_defaults_to_requiring_bump(version_repo) -> None:
    repo, base = version_repo
    _commit_file(repo, "future-runtime/config.toml", "changed\n")
    assert _check(repo, base).returncode != 0


def test_runtime_change_with_patch_bump_passes(version_repo) -> None:
    repo, base = version_repo
    _set_versions(repo, "0.7.1")
    _commit_file(repo, "packages/api/blogforge/server.py", "changed\n", add_all=True)
    assert _check(repo, base).returncode == 0
```

Also cover mixed exempt/non-exempt files and mismatched web/API versions.

- [ ] **Step 2: Run the tests and verify RED**

Run: `uv run pytest packages/api/tests/test_version_scripts.py -q`

Expected: FAIL because `scripts/check-version-bump.sh` does not exist.

- [ ] **Step 3: Implement conservative changed-path classification**

Implement `scripts/check-version-bump.sh` with `set -euo pipefail`. Require one base-ref argument; run `scripts/version.sh check`; obtain changed paths using `git diff --name-only --diff-filter=ACMRT "$base_ref"...HEAD`; and exempt only the exact patterns in the spec. If any path is non-exempt, read the base versions with `git show`, verify they matched at the base, read the current version, and call:

```bash
scripts/version.sh compare "$base_version" "$candidate_version"
```

The failure message must include both versions and `scripts/version.sh patch` as the normal repair command.

- [ ] **Step 4: Add the pull-request workflow**

Create `.github/workflows/version-check.yml` that checks out with `fetch-depth: 0`, sets up Node 20, and runs:

```yaml
- name: Require release version for deployable changes
  run: scripts/check-version-bump.sh "${{ github.event.pull_request.base.sha }}"
```

Trigger it for `pull_request` so CI-only edits are evaluated but exempt.

- [ ] **Step 5: Run focused tests and syntax checks**

Run:

```bash
uv run pytest packages/api/tests/test_version_scripts.py -q
bash -n scripts/version.sh scripts/check-version-bump.sh
```

Expected: all tests pass; both scripts parse successfully.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-version-bump.sh packages/api/tests/test_version_scripts.py .github/workflows/version-check.yml
git commit -m "ci(release): require versions for deployable changes"
```

### Task 3: Pre-mutation production deployment guard

**Files:**
- Modify: `scripts/deploy-home.sh`
- Modify: `packages/api/tests/test_home_deploy_scripts.py`

**Interfaces:**
- Consumes: the candidate revision's `scripts/version.sh compare` interface.
- Produces: deployment refusal before `git checkout main` or `git merge --ff-only` when `previous_sha != intended_sha` and the candidate version is not greater.

- [ ] **Step 1: Make the fake deployment repository version-aware**

In `deploy_repo`, create synchronized `0.6.4` web/API version files and copy `scripts/version.sh` before the initial commit. Stop overwriting `version.sh` in `_remote_clone`. Add a helper that bumps both fixture files and updates fake health output for successful candidate deployments.

- [ ] **Step 2: Add failing deployment-gate tests**

Add tests for:

```python
def test_deploy_rejects_new_sha_with_same_version_before_checkout(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    before = _git(remote, "rev-parse", "HEAD")
    _commit_file(repo, "tracked.txt", "new release without bump\n")
    _git(repo, "push", "origin", "main")
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode != 0
    assert "must be greater" in result.stderr
    assert _git(remote, "rev-parse", "HEAD") == before


def test_deploy_accepts_new_sha_with_patch_bump(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    _set_versions(repo, "0.6.5")
    (repo / "tracked.txt").write_text("versioned release\n")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "versioned release")
    _git(repo, "push", "origin", "main")
    env["PUBLIC_HEALTH"] = '{"status":"ok","version":"0.6.5"}'
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode == 0, result.stderr
    assert _git(remote, "rev-parse", "HEAD") == _git(repo, "rev-parse", "HEAD")


def test_deploy_allows_same_sha_redeploy(deploy_repo) -> None:
    repo, env, _ = deploy_repo
    remote = _remote_clone(repo, env)
    result = _run(repo, env, "deploy-home.sh")
    assert result.returncode == 0, result.stderr
    assert _git(remote, "rev-parse", "HEAD") == _git(repo, "rev-parse", "HEAD")
```

- [ ] **Step 3: Run focused deployment tests and verify RED**

Run: `uv run pytest packages/api/tests/test_home_deploy_scripts.py -q`

Expected: the same-version/new-SHA case currently succeeds, so the new assertion fails.

- [ ] **Step 4: Implement the remote guard before checkout mutation**

After `git fetch origin main` and fast-forwardability validation, but before `git checkout main`, read the current version from the current checkout and candidate versions from `git show "$intended_sha:<version-file>"`. Reject candidate web/API mismatch. When SHAs differ, extract the candidate `scripts/version.sh` into a temporary file, run its `compare` operation, remove it via a trap, and only then continue to checkout/merge/redeploy. Emit current and candidate versions on failure.

- [ ] **Step 5: Run focused tests and syntax**

Run:

```bash
uv run pytest packages/api/tests/test_home_deploy_scripts.py -q
bash -n scripts/deploy-home.sh scripts/rollback-home.sh scripts/version.sh
```

Expected: all deployment tests pass and scripts parse successfully.

- [ ] **Step 6: Commit**

```bash
git add scripts/deploy-home.sh packages/api/tests/test_home_deploy_scripts.py
git commit -m "fix(deploy): block releases without newer versions"
```

### Task 4: Corrective `0.7.1` release and operator documentation

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/api/blogforge/__init__.py`
- Modify: `docs/home-services-deploy.md`

**Interfaces:**
- Produces: synchronized `0.7.1` web/API identity and documented operator recovery.

- [ ] **Step 1: Bump the release version**

Run:

```bash
scripts/version.sh patch
scripts/version.sh check
```

Expected: `0.7.0 → 0.7.1` and `version in sync: 0.7.1`.

- [ ] **Step 2: Document the enforced release rule**

Update `docs/home-services-deploy.md` to state that a new SHA must have a greater semantic version, recommend `scripts/version.sh patch` for fixes, and explain that identical-SHA recovery redeploys remain allowed.

- [ ] **Step 3: Verify the PR checker against main**

Run:

```bash
scripts/check-version-bump.sh origin/main
```

Expected: success with baseline `0.7.0` and candidate `0.7.1`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json packages/api/blogforge/__init__.py docs/home-services-deploy.md
git commit -m "chore(release): bump BlogForge to 0.7.1"
```

### Task 5: Full verification, review, merge, and deployment

**Files:**
- Verify all files changed by Tasks 1-4.

**Interfaces:**
- Produces: reviewed main-branch release `0.7.1`, deployed at the exact merge SHA.

- [ ] **Step 1: Run complete relevant verification**

Run:

```bash
uv run pytest packages/api/tests/test_version_scripts.py packages/api/tests/test_home_deploy_scripts.py -q
uv run ruff check packages/api/tests/test_version_scripts.py packages/api/tests/test_home_deploy_scripts.py
bash -n scripts/version.sh scripts/check-version-bump.sh scripts/deploy-home.sh scripts/rollback-home.sh
scripts/version.sh check
scripts/check-version-bump.sh origin/main
pnpm --dir packages/web build
git diff --check origin/main...HEAD
```

Expected: zero failures, version `0.7.1`, successful build, and clean diff check.

- [ ] **Step 2: Request code review and resolve findings**

Review correctness, security, test coverage, exemption patterns, and the guarantee that deployment rejection occurs before checkout mutation. Apply only verified fixes and rerun Step 1.

- [ ] **Step 3: Push, open a PR, merge, and synchronize local main**

Push `codex/enforce-version-increments`, create a ready PR summarizing the release rule and tests, merge after checks/review, and fast-forward local `main` to the merge SHA.

- [ ] **Step 4: Deploy and verify production identity**

Run:

```bash
./scripts/deploy-home.sh
```

Expected: the output identifies the exact merged SHA and both internal and public health responses contain `"version":"0.7.1"`.
