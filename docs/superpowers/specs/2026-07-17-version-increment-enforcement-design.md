# Version Increment Enforcement Design

**Date:** 2026-07-17

## Goal

Make every deployable BlogForge change identify itself with a newer semantic
version, so the UI and `/api/health` always distinguish one production release
from the next. The Codex draft-provider hotfix will become version `0.7.1`.

## Release rule

- A change to deployable application code or runtime configuration must increase
  the version by at least one patch component (`x.y.z` where `z` increases).
- A minor or major increase also satisfies the rule.
- Versions must move strictly forward; unchanged or lower versions fail.
- Documentation-only changes do not require a version bump.
- Redeploying the exact commit already checked out on production is allowed. This
  supports service restarts and recovery without inventing a new release.

The existing two version locations remain authoritative:

- `packages/web/package.json`
- `packages/api/blogforge/__init__.py`

`scripts/version.sh` remains the supported way to update them together.

## Reusable version checks

Extend `scripts/version.sh` with a comparison operation that validates strict
semantic-version ordering. It will reject malformed versions and return a
nonzero status unless the candidate version is greater than the baseline.
Comparison follows numeric semantic-version ordering for the three supported
components, so `0.8.0 > 0.7.9` and `1.0.0 > 0.99.99`.

The same comparison behavior will be exercised by both PR validation and the
production deploy guard, avoiding two subtly different definitions of “newer.”

## Pull-request validation

Add a repository check that compares the PR head with its base revision.

A version increase is required by default. A PR is exempt only when every
changed path belongs to this explicit non-runtime allowlist:

- documentation: `docs/**`, `README.md`, and `CHANGELOG.md`;
- tests: `e2e/**`, `packages/**/tests/**`, `**/*.test.*`, `**/*.spec.*`, and
  `playwright.config.ts`;
- CI and assistant metadata: `.github/**`, `.claude/**`, and `.superpowers/**`;
- non-production design artifacts: `design-previews/**` and root-level image
  files used as screenshots.

Everything else—including new paths not anticipated by this design—requires a
version increase. This conservative default prevents a future runtime directory
or manifest from silently bypassing the check. A PR containing both exempt and
non-exempt files is not exempt.

Validation will also run `scripts/version.sh check`, ensuring the web and API
versions agree. Failure output will state the baseline version, candidate
version, and the exact bump command to run.

## Deployment guard

Before the production checkout is fast-forwarded, `scripts/deploy-home.sh` will
read:

- the currently deployed checkout SHA and version; and
- the intended local/main SHA and version.

If the SHAs differ, the candidate version must be strictly greater than the
current production version. The script stops before building, changing the
remote checkout, or restarting the service when this check fails. If the SHAs
match, a redeploy is allowed with the same version.

This check is deliberately independent of the public health endpoint. It works
during an outage and compares against the actual production checkout that the
deployment script is about to replace.

Rollback behavior remains unchanged: rollback may intentionally move to an
older version. A later normal deployment must still be newer than the rolled
back checkout.

## Current corrective release

Run `scripts/version.sh patch` to move `0.7.0` to `0.7.1`. The version bump and
enforcement changes will ship in the same pull request. After merge, deploy
`0.7.1` and verify both internal and public health responses report `0.7.1`.

## Testing

Automated tests will cover:

- patch, minor, and major versions accepted as increases;
- equal, lower, and malformed versions rejected;
- deployable changes requiring a bump;
- documentation-only changes remaining exempt;
- mixed documentation and deployable changes requiring a bump;
- a different production SHA with the same version rejected before mutation;
- a different SHA with a newer version accepted;
- the same SHA allowed for redeployment; and
- the web/API version synchronization check.

The final verification will run the focused version/deployment tests, shell
syntax checks, the repository's standard test/lint/build checks relevant to the
changed files, and production internal/public health verification after merge.

## Out of scope

- Automatic selection of patch versus minor versus major based on commit text.
- Automatic tagging or publishing of GitHub Releases.
- Requiring version bumps for documentation-only or CI-only changes.
- Changing rollback semantics.
