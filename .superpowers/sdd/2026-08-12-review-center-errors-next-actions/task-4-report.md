# Task 4 report: Stage-aware next action

## Status

Complete.

## Implementation

- Added the pure `deriveNextDraftAction` model for all nine approved research, outline, generation, recovery, drift, and review states.
- Added the compact `NextDraftAction` editorial margin note directly below `StageNav`, with a cobalt left rule, `NEXT` label, concise guidance, and exactly one strong action.
- Wired create-outline, compose, retry remaining, finish remaining, outline jump, Review Center, and Setup focus behavior to existing workspace callbacks.
- Added stable `draft-setup` and `draft-setup-toggle` DOM targets. The missing-model link reveals a collapsed Setup disclosure, scrolls it into view, and focuses its toggle.
- Recovery derives from both the current job error and persisted `failed` section status, so reopened failed drafts keep completed work and retry only unwritten sections.
- Removed duplicate compose/retry progression controls from `OutlinePanel` and `SectionsPanel` while retaining regenerate, failure detail, dismiss, and contextual revision controls.
- Demoted the Research `Send`, `Start the interview`, and `Accept this outline` controls from `nb-btn-primary` so the Next card owns stage progression.

## Extra files

The approved brief allowed `ResearchPanel.tsx` to be changed for single-primary hierarchy. This implementation also updates `ResearchPanel.test.tsx` to cover that behavior. `OutlinePanel.test.tsx` was added to protect removal of its duplicate compose control.

## Test-first evidence

- The initial focused run failed because `draftNextAction`, `NextDraftAction`, Setup DOM targets, and the removal of both Sections progression buttons were not yet implemented.
- Separate red runs confirmed the Outline compose control and Research primary classes before those production changes were applied.
- `npm test`: 91 files passed, 453 tests passed.
- `npm run build`: passed TypeScript and Vite production build.
- Focused Biome check for the five new source/test files: passed.

## Concerns

- The repository-wide `npm run lint` remains red on 79 pre-existing formatting and accessibility diagnostics in unrelated files. No Task 4 diagnostic remains in the focused check of new files.
- Vite continues to report the existing `HeadlineLab` static/dynamic import chunking warning during a successful build.

## Review fix round: remaining-only preservation and request recovery

### Status

Complete.

### Implementation

- Added an explicit `remaining_only` expand mode from the web client through the FastAPI route and background task.
- Remaining-only jobs still generate one coherent document, but snapshot, mark generating, fail, emit progress for, and write back only `empty`, `generating`, or `failed` targets. `ready` and `edited` sections and their version histories are not touched.
- Wired DraftPage Retry and Finish to `expandSections(id, { remainingOnly: true })`; full Compose still uses the default full replacement mode.
- Made `NextDraftAction` await callbacks, guard against double clicks, expose rejected requests through `ErrorNotice`, and return its action to an enabled state after failure.
- Made DraftWorkspace reset transient composing and advancing state when either full Compose or remaining-only expansion rejects before SSE begins, while retaining the SSE-driven composing state after a successful POST.
- Added behavior coverage for remaining-only callback routing, DraftPage query-mode wiring, rejected Retry and full Compose recovery, reopened failed drafts preserving completed prose, real Setup disclosure reveal/focus, and Review outline stage jump.

### Additional files in this fix round

- `packages/api/blogforge/api/expand.py`
- `packages/api/tests/api/test_expand_route.py`
- `packages/web/src/api/drafts.ts`
- `packages/web/src/routes/DraftPage.tsx`
- `packages/web/tests/routes/DraftPage.test.tsx`
- `packages/web/tests/components/DraftWorkspace.nextAction.test.tsx`

### Test-first and verification evidence

- Red API run: `uv run pytest packages/api/tests/api/test_expand_route.py -q` produced `1 failed, 3 passed`; the completed section was overwritten before remaining-only mode existed.
- Red frontend run: `npm test -- --run tests/components/NextDraftAction.test.tsx tests/components/DraftWorkspace.nextAction.test.tsx` produced `2 failed, 10 passed`; duplicate clicks were accepted and rejected requests escaped without recovery UI.
- Focused API: `uv run pytest packages/api/tests/api/test_expand_route.py -q` produced `4 passed in 0.88s`.
- Focused frontend: `npm test -- --run tests/components/NextDraftAction.test.tsx tests/components/DraftWorkspace.nextAction.test.tsx tests/routes/DraftPage.test.tsx` produced `3 files passed, 17 tests passed`.
- Full frontend: `npm test` produced `92 files passed, 461 tests passed`.
- Production build: `npm run build` passed TypeScript and Vite after an intermediate red build exposed and prompted an explicit null guard for the error state.
- Focused web formatting/lint: `npx biome check` on all changed web source and test files passed.
- Focused API formatting/lint: `uv run ruff check ...` and `uv run ruff format --check ...` passed for the expand route and API test.

### Concerns

- The successful Vite build retains the existing `HeadlineLab` static/dynamic import chunking warning.
- The full web suite passes but prints existing React Router future-flag and unrelated `act(...)` warnings.
