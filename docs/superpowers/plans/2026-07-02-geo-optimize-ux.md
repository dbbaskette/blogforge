# GEO + Proofreader Optimize-Mode UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inconsistent GEO/Proofreader panels with one shared issue-card model (red → review → green lifecycle, adaptive actions, per-issue undo, live score) presented in a dedicated two-pane Optimize mode.

**Architecture:** A shared frontend core — an `Issue` model, a pure `<IssueCard>`, a `useIssueLifecycle` state machine, and one action adapter per action kind — feeds both a thin GEO panel adapter and a thin Proofreader adapter. Both render into a two-pane Optimize layout. The three built-but-dead backend levers (citations, takeaways, alt-text) get wired in.

**Tech Stack:** React 18 + TypeScript + Vite + TipTap/ProseMirror + Tailwind; Vitest + Testing Library. Backend FastAPI (already has all endpoints except minor test gaps).

**Spec:** `docs/superpowers/specs/2026-07-02-geo-optimize-ux-design.md`

---

## File structure

Frontend, all under `packages/web/src`:

- `lib/issues/types.ts` — the `Issue` model + action/status/nature unions (Task 1).
- `lib/issues/geoAdapter.ts` — `geoFindingsToIssues(report)` (Task 6).
- `lib/issues/proofreadAdapter.ts` — `proofreadFindingsToIssues(lint)` (Task 13).
- `lib/issues/actions.ts` — action adapters returning `{ before, after, apply, revert }` (Task 3).
- `components/review/IssueCard.tsx` — pure presentation (Task 2).
- `components/review/useIssueLifecycle.ts` — state machine + effects (Task 4).
- `components/review/OptimizePanel.tsx` — two-pane shell + issues rail + segmented header (Tasks 9–11).
- `components/draft/trackedChangeDecoration.ts` — extend for `under-review` / `locate` kinds (Task 5).
- `components/draft/GeoPanel.tsx` → reduced to a thin adapter that builds issues and renders the rail (Task 7–8).
- `components/draft/LintPanel.tsx` → reduced to Proofreader adapter (Task 13).

Backend, under `packages/api/blogforge`:

- No new endpoints. Add tests for `/geo/takeaways`, `/geo/alt`, `/geo/cite`, `/geo/quotes` where missing (Task 12).

Tests mirror sources under `packages/web/tests/...` and `packages/api/tests/...`.

---

## Phase 1 — Shared core (no visible change yet)

### Task 1: Issue model

**Files:**
- Create: `packages/web/src/lib/issues/types.ts`
- Test: `packages/web/tests/lib/issues/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isFixNature, type Issue } from "../../../src/lib/issues/types";

const base: Issue = {
  id: "i1", panel: "geo", lever: "answer_first",
  title: "This section buries its answer", why: "Lead with the takeaway.",
  nature: "fix", sectionId: "s1", target: "There are a few things…",
  actions: ["ai_fix", "manual_fix", "highlight"], status: "open",
};

describe("Issue model", () => {
  it("classifies fix vs non-fix natures", () => {
    expect(isFixNature(base)).toBe(true);
    expect(isFixNature({ ...base, nature: "add" })).toBe(false);
    expect(isFixNature({ ...base, nature: "advisory" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/lib/issues/types.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type IssueNature = "fix" | "add" | "advisory";
export type IssueStatus = "open" | "review" | "accepted";
export type IssueAction =
  | "ai_fix" | "manual_fix" | "highlight"
  | "generate" | "write_own"
  | "cite_source" | "quote_source"
  | "add_fact" | "add_date"
  | "dedupe" | "dismiss";

export interface Issue {
  id: string;
  panel: "geo" | "proofread";
  lever: string;
  title: string;
  why: string;
  nature: IssueNature;
  sectionId: string;
  target?: string;
  actions: IssueAction[];
  status: IssueStatus;
}

export function isFixNature(issue: Issue): boolean {
  return issue.nature === "fix";
}
```

- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(review): Issue model for unified GEO/Proofreader cards"`

### Task 2: `<IssueCard>` presentation

**Files:**
- Create: `packages/web/src/components/review/IssueCard.tsx`
- Test: `packages/web/tests/components/review/IssueCard.test.tsx`

Renders an `Issue` + callbacks; shows status dot/label/title, `why`, `target` (fix only), and one button per `action`. Accepts `onAction(action)`, `onAccept()`, `onUndo()`. In `review` status shows Accept + Undo; in `accepted` shows a slim done row + Undo; in `open` shows the action buttons.

- [ ] **Step 1: Failing test** — assert an `open` fix issue renders "AI fix", "Manual fix", "Highlight" buttons and the title; a `review` issue renders "Accept" + "Undo"; an `accepted` issue renders a check + "Undo"; clicking "AI fix" calls `onAction("ai_fix")`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the component. Button label map: `ai_fix→"AI fix"`, `manual_fix→"Manual fix"`, `highlight→"Highlight"`, `generate→"Generate"`, `write_own→"Write my own"`, `cite_source→"Cite source"`, `quote_source→"Quote"`, `add_fact→"Add a fact"`, `add_date→"Add a date"`, `dedupe→"Remove duplicate"`, `dismiss→"Dismiss"`. Border color by status: open→`border-danger` (advisory→neutral `border-rule`), review→`border-warning`, accepted→`border-success`. Manual/write_own/add_fact/add_date open an inline `<textarea>` on the card whose "Apply" calls `onAction(action, text)`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

### Task 3: Action adapters

**Files:**
- Create: `packages/web/src/lib/issues/actions.ts`
- Test: `packages/web/tests/lib/issues/actions.test.ts`

Each adapter is `(issue, ctx, input?) => Promise<Applied>` where `Applied = { before: string; after: string; sectionId: string; kind: "content" | "title" | "opening" }`. `ctx` provides the current section content + api clients + draftId. Adapters call existing api/geo.ts + api/drafts.ts clients; they compute `before`/`after` and return them (they do NOT save — the hook saves, so undo is centralised).

Adapters: `aiRewrite` (inlineEdit with per-lever instruction), `generateInsert` (opener/faq/table/takeaways/alt → append or prepend), `manualEdit` (input text replaces target), `citeSource`/`quoteSource` (/geo/cite, /geo/quotes), `addFact`/`addDate` (inlineEdit weaving user text), `dedupe` (deterministic), `dismiss` (no content change; marks resolved).

- [ ] **Step 1: Failing test** — mock api clients; assert `manualEdit` returns `{before: target, after: input, kind: "content"}` spliced into the section; assert `aiRewrite` calls `inlineEdit` with the lever's instruction and returns the model text as `after`.
- [ ] **Step 2–5:** implement per-adapter, test, commit. Reuse the exact instruction strings currently in `GeoPanel.tsx:241-257` (move them into a `LEVER_INSTRUCTION` map in this file so they're shared).

### Task 4: `useIssueLifecycle` hook

**Files:**
- Create: `packages/web/src/components/review/useIssueLifecycle.ts`
- Test: `packages/web/tests/components/review/useIssueLifecycle.test.tsx`

Owns per-issue `status` + an undo ledger (localStorage `bf.review.undo.{draftId}`). API: `const { statusOf, apply, accept, undo } = useIssueLifecycle({ draftId, ctx, onSectionSave, onHighlight, onRescore })`.
- `apply(issue, action, input?)`: runs the adapter → `onSectionSave(sectionId, after)` → records undo `{before}` → `onHighlight(sectionId, after-run, "under-review")` → `onRescore(issue.lever)` → set status `review`.
- `accept(issue)`: clear the under-review highlight → status `accepted`.
- `undo(issue)`: `onSectionSave(sectionId, before)` from ledger → `onRescore(lever)` → status `open` (drop ledger entry).

- [ ] **Step 1: Failing test** — render the hook via a harness; `apply` an issue → status becomes `review`, `onSectionSave` + `onRescore` called; `accept` → `accepted`; `undo` → `open` and `onSectionSave` called with the original `before`.
- [ ] **Step 2–5:** implement, test, commit.

### Task 5: Editor highlight kinds

**Files:**
- Modify: `packages/web/src/components/draft/trackedChangeDecoration.ts`
- Test: `packages/web/tests/components/trackedChangeDecoration.test.ts` (new — pure buildDecorations unit)

Extend the plugin state from `string[]` to `{ text: string; kind: "under-review" | "locate" | "pending" }[]`; `buildDecorations` sets class `tracked-change tracked-change--{kind}`. Keep back-compat: a bare `string[]` meta coerces to `kind: "pending"`.

- [ ] **Step 1: Failing test** — `buildDecorations(doc, [{text:"foo", kind:"under-review"}])` yields a decoration with class containing `tracked-change--under-review`.
- [ ] **Step 2–5:** implement, add CSS for `--under-review` (amber bg) and `--locate` (transient) in `index.css`, test, commit.

---

## Phase 2 — GEO panel adapter (rail renders via shared core)

### Task 6: `geoFindingsToIssues`

**Files:**
- Create: `packages/web/src/lib/issues/geoAdapter.ts`
- Test: `packages/web/tests/lib/issues/geoAdapter.test.ts`

Maps a `GeoReport` → `Issue[]`: iterate `report.levers`, for each lever's `findings`, emit one Issue with `nature` + `actions` from a per-lever config table (mirrors spec §5). Advisory findings (freshness, first-hand) get `nature:"advisory"`, `actions:["dismiss", ...]`.

- [ ] **Step 1: Failing test** — feed a report with an `answer_first` finding and a `freshness` advisory; assert two issues with correct `nature`/`actions`; multi-finding lever yields multiple issues with distinct ids.
- [ ] **Step 2–5:** implement the config table, test, commit.

### Task 7: Render the GEO rail from Issues

**Files:**
- Modify: `packages/web/src/components/draft/GeoPanel.tsx`
- Test: extend `packages/web/tests/components/GeoPanel.test.ts`

Replace the bespoke finding-render loop with: `geoFindingsToIssues(report)` → group by lever → render `<IssueCard>` via `useIssueLifecycle`. Keep the existing score header + per-lever bars. Remove the now-dead bespoke apply/undo/addData handlers (superseded by adapters + hook).

- [ ] **Step 1: Failing test** — mount GeoPanel with a stub report; assert an issue card renders and clicking AI fix drives the hook (mock the api layer).
- [ ] **Step 2–5:** implement, test, commit.

### Task 8: Protected additions + score wiring parity

**Files:** Modify `GeoPanel.tsx`; reuse `carveProtectedAdditions`/additions store as-is inside the `generateInsert`/`aiRewrite` adapters (pass through `ctx`).

- [ ] Verify opener/FAQ survive rewrites (existing behavior) still holds via a test; verify accept advances "N of M resolved" and score reflects rescore. Commit.

---

## Phase 3 — Two-pane Optimize mode

### Task 9: `OptimizePanel` shell

**Files:**
- Create: `packages/web/src/components/review/OptimizePanel.tsx`
- Test: `packages/web/tests/components/review/OptimizePanel.test.tsx`

Two-pane split: left = the draft (reuse the existing sections render read-only-ish or the live editor), right = issues rail. Slim header: back, "Optimize", "N of M resolved", score chip, `All · SEO · Proofreading` segmented control, Done. Collapses the nav rail (prop/callback to `DraftWorkspace`).

- [ ] **Step 1: Failing test** — renders header with score + segmented control; segmented control filters issues by `panel` (All shows both).
- [ ] **Step 2–5:** implement, test, commit.

### Task 10: Wire OptimizePanel into DraftWorkspace

**Files:** Modify `packages/web/src/components/draft/DraftWorkspace.tsx`

Replace the `geoOpen`/`lintOpen` drawer toggles with a single `optimizeOpen` mode that renders `<OptimizePanel>` in-grid (editor left, rail right), collapsing the nav rail. Keep a small-screen stacked fallback.

- [ ] Test the mode toggle + fallback; commit.

### Task 11: Left-pane highlight integration

**Files:** Modify `OptimizePanel.tsx` + section editors.

Route `onHighlight(sectionId, text, kind)` from the hook to the section's editor decoration (Task 5). Highlight action = `locate` (transient); applied change = `under-review`; accept clears it.

- [ ] Test that applying an issue adds an under-review decoration to the right section; commit.

---

## Phase 4 — Wire the three dead levers + upgrades

### Task 12: Backend endpoint tests

**Files:** `packages/api/tests/api/test_geo_*` (add where missing) for `/geo/takeaways`, `/geo/alt`, `/geo/cite`, `/geo/quotes`.

- [ ] Add request/response tests (mock provider) confirming shape; commit.

### Task 13: Citations, takeaways, alt-text in the adapters + config

**Files:** `lib/issues/geoAdapter.ts`, `lib/issues/actions.ts`, `api/geo.ts` (already has clients).

- [ ] Add config rows: citations → `cite_source`/`quote_source`/`highlight`; takeaways → `generate`/`write_own`; alt-text (skimmability sub-finding) → `generate`/`write_own`/`highlight`. Implement `citeSource`/`quoteSource` adapters (reference picker input). Brand → `ai_fix`; freshness → advisory `add_date`/`highlight`/`dismiss`. Tests per adapter; commit.

---

## Phase 5 — Proofreader adapter

### Task 14: `proofreadFindingsToIssues` + LintPanel rail

**Files:**
- Create: `packages/web/src/lib/issues/proofreadAdapter.ts` (+ test)
- Modify: `packages/web/src/components/draft/LintPanel.tsx`

Map lint findings → `Issue[]` (`panel:"proofread"`, mostly `nature:"fix"` with `ai_fix`/`manual_fix`/`highlight`). Render via `<IssueCard>` + `useIssueLifecycle` inside OptimizePanel's Proofreading segment. Retire the standalone "Approve changes (N)" flow (per-issue accept replaces it).

- [ ] Tests: mapper + a lint issue drives the same lifecycle; commit.

### Task 15: Cleanup + full-suite verification

- [ ] Remove dead code paths in GeoPanel/LintPanel superseded by the shared core. Run full `vitest` + `pytest` (expect only the known MinIO/`myvoice` env failures). Build the web bundle. Commit.

---

## Self-review

- **Spec coverage:** card+lifecycle (T2,T4), adaptive actions (T2,T3,T6,T13), per-lever mapping (T6,T13), advisory+dismiss (T6,T13), score on apply/undo (T4,T8), highlight kinds (T5,T11), two-pane layout (T9–T11), Proofreader unify (T14), wire 3 dead levers (T12,T13), decomposition (T7,T14). Covered.
- **Types consistent:** `Issue`, `IssueAction`, `Applied` used identically across T1–T14.
- **No placeholders:** each task names files, tests, and concrete interfaces; code detail is fullest for the novel core (T1–T5) and specified-by-interface for mechanical assembly (T7–T14), to be filled from the named existing code (`GeoPanel.tsx` instruction strings, `api/geo.ts` clients).
