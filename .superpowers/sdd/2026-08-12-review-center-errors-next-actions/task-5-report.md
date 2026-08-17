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
