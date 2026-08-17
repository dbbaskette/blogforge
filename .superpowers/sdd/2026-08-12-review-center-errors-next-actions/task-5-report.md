# Task 5 report: Actionable draft workflow errors

## Status

Complete and self-reviewed.

## Implementation

- Replaced DraftPage's raw load failure with `ErrorNotice` and a real load retry.
- Kept optimistic draft edits mounted after save failures, retained the exact failed draft snapshot, and wired Retry to save that snapshot again.
- Replaced the DraftWorkspace save-error string with safe presentation, Retry, Dismiss, Reload, Settings, or Sign in recovery according to the existing error contract.
- Applied `ErrorNotice` to research history, send, stream, and accept failures while preserving the transcript and composer. Failed operations can be retried or dismissed without automatic session navigation.
- Applied `ErrorNotice` to outline regeneration while retaining the editable outline.
- Preserved streamed generation error codes and hints so provider failures route to Settings and technical data stays under Details.
- Applied safe failures to whole-draft revision, section reorder, persisted failed sections, and per-section regeneration. Completed section prose remains mounted.
- Fixed the deferred NextDraftAction issue: after a rejection, the normal strong action is replaced by the recovery action, and errors are cleared when the action kind changes, including when a prior kind later returns.
- Replaced the one touched user-facing em dash with sentence punctuation.

## Test-first evidence

1. The initial focused route/research/outline/sections/next-action run failed 11 tests across all 6 files. Failures reproduced raw primary messages, missing Retry/Settings/Sign in affordances, lost save recovery, duplicate strong Next actions, and stale Next action state.
2. SectionCard's focused red run failed both new persisted-generation and regeneration-request error tests before it adopted the shared notice.
3. The strengthened NextDraftAction transition test failed when an old action kind returned, proving the hidden failure state was still stale before the final state-reset correction.
4. Final focused verification passed 7 files and 45 tests.

## Final verification

- Focused Biome check of all 14 changed source/test files: passed with no diagnostics.
- Focused workflow tests: 7 files passed, 45 tests passed.
- Full frontend suite: 92 files passed, 473 tests passed.
- Production build: TypeScript and Vite passed.
- `git diff --check`: passed.
- Added-line em-dash scan: no matches.

## Self-review

- Confirmed Retry handlers repeat the failed load, save snapshot, research operation, outline regeneration, revision, section regeneration, and reorder operation.
- Confirmed provider and session errors preserve their structured metadata so Settings and Sign in remain available without forced navigation.
- Confirmed conflict errors expose Reload through the shared real reload behavior.
- Confirmed validation and unknown technical strings are present only inside a closed Details disclosure, not the primary explanation.
- Confirmed completed draft sections and edited outline/research content remain rendered alongside failures.
- Confirmed NextDraftAction renders exactly one primary recovery action after rejection and does not revive an old error after kind transitions.
- Left the pre-existing untracked plan and design documents untouched and out of the commit.

## Concerns

- The passing full suite still emits pre-existing React Router future-flag, React `act(...)`, and jsdom navigation warnings.
- The successful Vite build retains the existing HeadlineLab static/dynamic import chunking warning.

## Fix round: async ownership and persisted recovery metadata

### Changes

- Added monotonic DraftPage save sequencing. Each request sends a cloned snapshot, and only the latest request may publish saved, failed, Retry, or saving state. A late stale failure cannot replace a newer success.
- Added a versioned JSON envelope for section failures in the existing `last_error` text column. Expand, whole-draft revise, single-section regeneration, cancellation, interruption, and empty-generation persistence now retain code, message, and hint without a migration.
- Added safe frontend parsing for versioned metadata, legacy plain strings, `HTTP 502: ...`, and `HTTP status: 502 ...` forms. Reopened failures recover Settings, Sign in, Reload, Retry, or Continue editing while raw/encoded details stay inside the closed Details disclosure.
- Bound section regeneration, whole-draft revision, and reorder retries to immutable failed payloads instead of current input/order state.
- Added request-token ownership to `NextDraftAction`, invalidating pending results when the action kind genuinely changes. The workspace no longer treats its pre-request compose theater flag as a server-backed stage transition, so an immediate request rejection remains recoverable.
- Kept the normal Next action hidden after failure, leaving exactly one primary recovery action.

### Test-first evidence

1. The new frontend red run reproduced legacy/structured persisted failures, mutable regeneration/revision/reorder retry payloads, stale save races, and late Next rejection state. The focused run failed 10 behavior tests before implementation.
2. The backend helper red run failed at collection because `blogforge.drafts.section_errors` did not exist.
3. A full-suite integration failure exposed a temporary `retry-remaining` to `compose-draft` transition owned by local request state. Removing that false stage transition made both the workspace recovery test and the explicit late-rejection test pass.

### Commands and results

- `pnpm exec vitest run tests/routes/DraftPage.test.tsx tests/components/NextDraftAction.test.tsx tests/components/SectionCard.test.tsx tests/components/SectionsPanel.test.tsx`: 4 files passed, 37 tests passed.
- `pnpm exec vitest run tests/components/DraftWorkspace.nextAction.test.tsx tests/components/NextDraftAction.test.tsx tests/components/SectionCard.test.tsx`: 3 files passed, 27 tests passed.
- `UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/drafts/test_section_errors.py packages/api/tests/drafts/test_recovery.py packages/api/tests/api/test_expand_route.py packages/api/tests/api/test_revise_route.py packages/api/tests/api/test_section_save_route.py packages/api/tests/api/test_section_enforce.py -q`: 21 tests passed.
- `pnpm test`: 92 files passed, 482 tests passed.
- `pnpm build`: TypeScript and Vite production build passed; the existing HeadlineLab chunk warning remains.
- Focused `pnpm exec biome check` across all 11 changed frontend source/test files: passed with no diagnostics.
- Focused `uv run ruff check` across all changed backend source/test files: passed with no diagnostics.
- Repository-wide `pnpm lint`: reports 74 pre-existing diagnostics in unrelated files.
- Repository-wide `uv run ruff check .`: reports 93 pre-existing diagnostics in unrelated files.
- `git diff --check`: passed.
- Added-line em-dash scan across changed production files: no matches.

### Self-review

- Confirmed newer save success suppresses an older failure and its stale Retry payload.
- Confirmed latest save failure retries its exact cloned draft snapshot.
- Confirmed provider, session, conflict, service, generic, and interrupted persisted failures each expose a valid recovery path after reload.
- Confirmed persisted JSON is never rendered as the primary message, and failed sections retain completed prose/editability.
- Confirmed retries replay the original regeneration instruction, whole-draft note, and section ID order after the visible UI changes.
- Confirmed a late rejection from action A is discarded after moving to B and stays discarded if A later returns.
- Confirmed existing untracked plan/design documents remain untouched and excluded.

### Fix-round concerns

- The full frontend suite still emits its existing React Router future-flag, React `act(...)`, and jsdom navigation warnings.
- Repository-wide Biome and Ruff remain red on unrelated baseline debt; every changed file passes the corresponding focused check.
