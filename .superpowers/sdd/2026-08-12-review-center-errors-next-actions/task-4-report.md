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
