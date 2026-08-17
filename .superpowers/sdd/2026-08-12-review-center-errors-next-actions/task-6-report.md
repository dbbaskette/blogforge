# Task 6: Release verification report

Date: 2026-08-17

## Release artifacts

- Set the synchronized web/API release version to `0.11.0` with
  `scripts/version.sh 0.11.0`.
- Added the `0.11.0` changelog entry covering the five-check Review Center,
  factual support and reference-aware refresh, actionable work-preserving
  errors, stage-aware Next action, and remaining-only Compose recovery. It
  records #135, #136, and #141 as resolved.
- Included the approved design specification and implementation plan in the
  release commit.

## Verification

| Check | Result |
| --- | --- |
| `scripts/version.sh check` | Passed: both surfaces report `0.11.0`. |
| `scripts/check-version-bump.sh origin/main` | Passed: `0.10.4` -> `0.11.0`. |
| `uv run pytest packages/api/tests -q` | Passed (exit 0). |
| `pnpm test` | Passed: 92 files, 485 tests. |
| `pnpm build` and `pnpm exec tsc -b --pretty false` | Passed. |
| Changed-file Biome | Passed: 36 TypeScript/TSX files checked. |
| Changed-file Ruff | Passed. |
| `git diff --check` | Passed. |
| Added-line user-facing em-dash scan | No added em dashes in `packages/web/src`. |

## Baseline concerns retained

- The frontend suite emits existing React Router future-flag warnings, React
  `act(...)` warnings, and one jsdom navigation notice despite passing.
- Vite emits an existing chunking advisory: `HeadlineLab` is both dynamically
  and statically imported.
- Repository-wide `pnpm lint` is not clean: Biome reports 66 errors in files
  outside this release's changed-file set. The changed-file Biome gate passes.
- Repository-wide `uv run ruff check packages/api` is not clean: it reports 93
  pre-existing errors. The changed-file Ruff gate passes.
- The configured full mypy run reports 176 errors in 39 files, so the project
  does not have a clean mypy baseline. Its changed-file sample reports six
  typing errors in `drafts/recovery.py`, `api/section.py`, and
  `api/revise.py`; this is distinct from the passing changed-file Ruff gate.

No tag, push, merge, or deployment was performed.
