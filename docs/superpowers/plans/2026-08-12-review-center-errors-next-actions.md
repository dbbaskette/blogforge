# Review Center, Actionable Errors, and Next Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one Review Center, recovery-oriented errors, and one stage-aware next action in the BlogForge draft workspace.

**Architecture:** Pure library functions own review summaries, error presentations, and next-action derivation. Small UI components render those models, while `DraftWorkspace` binds actions to existing generation and specialist-panel callbacks. Existing review panels and caches remain the implementation layer beneath the new entry point.

**Tech Stack:** React 18, TypeScript, Tailwind utility classes, Vitest, Testing Library, existing BlogForge API client and panel cache.

**Spec:** `docs/superpowers/specs/2026-08-12-review-center-errors-next-actions-design.md`

## Global Constraints

- Implement GitHub issues #135, #136, and #141 together.
- Automatically include Factual support in Review Center runs.
- Preserve partial review results and existing edits when any operation fails.
- Do not expose raw HTTP JSON as the primary error message.
- Do not add user-facing em dashes.
- Reuse BlogForge's existing visual tokens and specialist review panels.

---

### Task 1: Human-readable error boundary

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Create: `packages/web/src/lib/errors.ts`
- Create: `packages/web/src/components/ui/ErrorNotice.tsx`
- Modify: `packages/web/tests/api/clients.test.ts`
- Create: `packages/web/tests/lib/errors.test.ts`
- Create: `packages/web/tests/components/ErrorNotice.test.tsx`

**Interfaces:**
- Produces: `ApiError.detail`, `presentError(error, operation)`, and `ErrorNotice`.
- Consumes: existing structured API errors and React button/link patterns.

- [ ] Write tests proving validation arrays never become a raw JSON primary message and that structured metadata remains available.
- [ ] Run the API error tests and confirm the new expectations fail against the existing client.
- [ ] Implement safe API parsing and the pure presentation mapping for validation, provider, conflict, session, service, and unknown errors.
- [ ] Implement `ErrorNotice` with recovery actions and a technical Details disclosure.
- [ ] Run the focused error tests and the existing API-client tests.

### Task 2: Review Center model and UI

**Files:**
- Create: `packages/web/src/lib/reviewCenter.ts`
- Create: `packages/web/src/components/draft/ReviewCenter.tsx`
- Delete: `packages/web/src/lib/checkup.ts`
- Delete: `packages/web/src/components/draft/CheckupPanel.tsx`
- Replace: `packages/web/tests/lib/checkup.test.ts` with `packages/web/tests/lib/reviewCenter.test.ts`
- Create: `packages/web/tests/components/ReviewCenter.test.tsx`

**Interfaces:**
- Consumes: `lintDraft`, `checkClaims`, `analyzeGeo`, `suggestImprovements`, `analyzeHumanize`, panel cache, and `presentError`.
- Produces: `ReviewSummary`, `ReviewRow`, `summarizeReview`, `markReviewStale`, and the `ReviewCenter` overlay.

- [ ] Write review-model tests for editorial order, factual-support counts, no-reference availability, partial failures, and stale status conversion.
- [ ] Run the model tests and confirm they fail because the new model does not exist.
- [ ] Implement the summary model with five explicit per-check statuses and section anchors.
- [ ] Write a component test that proves all checks run, a failed check remains visible, and successful rows can open their tools.
- [ ] Run it and confirm the missing Review Center fails.
- [ ] Implement the Review Center, cache versioning, retry/re-run behavior, partial results, and Headlines follow-up.
- [ ] Run all focused review tests.

### Task 3: One Review entry point

**Files:**
- Modify: `packages/web/src/components/draft/WorkspaceFooter.tsx`
- Modify: `packages/web/src/components/draft/DraftWorkspace.tsx`
- Modify: `packages/web/tests/components/WorkspaceFooter.test.tsx`

**Interfaces:**
- Consumes: `ReviewCenter` and existing specialist-panel open callbacks.
- Produces: one footer `Review` button and routes each Review Center row to its specialist panel.

- [ ] Change the footer test to require one Review button and no Improve or Checkup controls.
- [ ] Run the footer test and confirm the old controls fail it.
- [ ] Replace the two old entry points with Review, wire the renamed overlay, Headlines follow-up, and section scrolling.
- [ ] Run footer and Review Center component tests.

### Task 4: Stage-aware next action

**Files:**
- Create: `packages/web/src/lib/draftNextAction.ts`
- Create: `packages/web/src/components/draft/NextDraftAction.tsx`
- Modify: `packages/web/src/components/draft/DraftWorkspace.tsx`
- Modify: `packages/web/src/components/draft/OutlinePanel.tsx`
- Modify: `packages/web/src/components/draft/SectionsPanel.tsx`
- Modify: `packages/web/src/components/draft/SetupDisclosure.tsx`
- Create: `packages/web/tests/lib/draftNextAction.test.ts`
- Create: `packages/web/tests/components/NextDraftAction.test.tsx`
- Modify: `packages/web/tests/components/SectionsPanel.test.tsx`

**Interfaces:**
- Produces: `deriveNextDraftAction(state): DraftNextAction` and `NextDraftAction`.
- Consumes: stage, outline count, unwritten count, running/failed state, outline drift, and existing workspace callbacks.

- [ ] Write table-driven derivation tests for new, blocked, outline, running, partial, failed, complete, and stale drafts.
- [ ] Run them and confirm the missing model fails.
- [ ] Implement the pure action derivation and the compact editorial Next card.
- [ ] Bind action kinds to generate, compose, retry, stage jump, Review Center, and Setup focus callbacks.
- [ ] Remove the duplicate primary progression buttons from Outline and Sections panels while retaining secondary controls and error context.
- [ ] Run focused action and workspace component tests.

### Task 5: Apply actionable errors to draft workflows

**Files:**
- Modify: `packages/web/src/routes/DraftPage.tsx`
- Modify: `packages/web/src/components/draft/DraftWorkspace.tsx`
- Modify: `packages/web/src/components/draft/ResearchPanel.tsx`
- Modify: `packages/web/src/components/draft/OutlinePanel.tsx`
- Modify: `packages/web/src/components/draft/SectionsPanel.tsx`
- Modify: relevant tests under `packages/web/tests/components` and `packages/web/tests/routes`

**Interfaces:**
- Consumes: `ErrorNotice` and `presentError` from Task 1.
- Produces: Retry, Open settings, Reload, Continue, and Details affordances at key draft failure points.

- [ ] Add component expectations that a failed save preserves the workspace and offers Retry, generation failures preserve completed sections, and load failures offer Retry.
- [ ] Run the focused tests and confirm current raw error treatments fail.
- [ ] Replace key raw error strings with `ErrorNotice` while retaining existing successful-content rendering.
- [ ] Run route, research, outline, and sections tests.

### Task 6: Release verification

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/api/blogforge/__init__.py`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: a deployable BlogForge release with a synchronized semantic version.

- [ ] Bump the compatible feature release from `0.10.4` to `0.11.0` using `scripts/version.sh` and document all three improvements.
- [ ] Run Biome, the TypeScript/Vite build, the full frontend test suite, Python checks/tests, and `scripts/check-version-bump.sh`.
- [ ] Inspect the final diff for unrelated files, raw HTTP JSON regressions, user-facing em dashes introduced by this release, and accidental cache/dependency artifacts.
