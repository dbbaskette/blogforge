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

## Fix round 2: cross-draft ownership and provider setup failures

### Changes

- Scoped save completion ownership to both a monotonic request sequence and the active draft ID. Route changes synchronously invalidate outstanding saves and clear draft-specific saving, error, and Retry state. A Retry can only replay the immutable failed snapshot against the draft that owns it.
- Applied the same route ownership check to draft loading and active-job discovery so late draft A work cannot attach to draft B.
- Moved provider construction inside typed provider-error handling for expand, whole-draft revise, and single-section regeneration. A real `ProviderMissingKey` from `build_provider_for` now persists the structured envelope on the affected sections, fails the job with the same metadata, and preserves completed prose.
- Reset a dismissed persisted section error when generation starts or the server clears the error. If the retry fails with byte-for-byte identical metadata, the new failure is visible again while the prior failure remains hidden during the active retry.

### Test-first evidence

1. The new route-change test failed because a late draft A save rejection rendered recovery inside draft B. It also proves a later draft B failure retries only B's exact snapshot at B's endpoint.
2. The realistic backend tests failed in expand, revise, and regeneration when `build_provider_for` raised `ProviderMissingKey`; no section envelope had been persisted before the fix.
3. The repeated-error lifecycle test failed because the second identical persisted envelope remained dismissed after the generating transition.

### Commands and results

- `pnpm exec vitest run tests/routes/DraftPage.test.tsx tests/components/SectionCard.test.tsx tests/components/NextDraftAction.test.tsx tests/components/SectionsPanel.test.tsx tests/components/DraftWorkspace.nextAction.test.tsx`: 5 files passed, 46 tests passed.
- `UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/api/test_expand_route.py packages/api/tests/api/test_revise_route.py packages/api/tests/api/test_section_save_route.py packages/api/tests/drafts/test_section_errors.py -q`: 17 tests passed.
- `pnpm test`: 92 files passed, 484 tests passed.
- `pnpm build`: TypeScript and Vite production build passed; the existing HeadlineLab chunk warning remains.
- Focused `pnpm exec biome check` for all changed frontend source and test files: passed with no diagnostics.
- Focused `uv run ruff check` for all changed backend source and test files: passed with no diagnostics.
- `git diff --check`: passed.

### Self-review

- Confirmed a route transition invalidates a pending old save before effects run, and late load, save, and active-job outcomes cannot publish into the new draft.
- Confirmed Retry requires the failed operation's draft ID to match the route and reuses its cloned snapshot.
- Confirmed expand remaining-only leaves completed sections ready and unchanged while persisting the provider failure only on targets.
- Confirmed revise and single-section regeneration retain existing content while persisting provider recovery metadata and emitting the same code through the job stream.
- Confirmed the existing parser-driven SectionCard behavior maps a reopened `provider_missing_key` envelope to Settings without displaying encoded JSON.
- Confirmed identical retried failures become visible after a real generation lifecycle, with the stale notice hidden while generation is active.
- Confirmed the prior exact retry payload and late Next-action ownership tests remain green.

### Fix-round 2 concerns

- The full frontend suite still emits pre-existing React Router future-flag, React `act(...)`, and jsdom navigation warnings.
- The successful Vite build retains the existing HeadlineLab static/dynamic import chunk warning.
