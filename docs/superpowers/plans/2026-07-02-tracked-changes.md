# Tracked-changes color — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Checkbox steps. Frontend-only.
> Run `npx vitest run` + `npx tsc --noEmit` before commit. Branch `feat/tracked-changes`
> (stacked on `feat/geo-enhancements`). Explicit `git add`.

**Goal:** color panel-applied added/modified words in the editor until approved (per-change or all).
Spec: `docs/superpowers/specs/2026-07-02-tracked-changes-design.md`.

**Files:**
- Create `packages/web/src/lib/trackedChanges.ts` (+ `tests/lib/trackedChanges.test.ts`)
- Modify `packages/web/src/components/draft/MarkdownEditor.tsx` (decoration plugin + prop)
- Modify `packages/web/src/index.css` (`.tracked-change`)
- Modify `packages/web/src/components/draft/GeoPanel.tsx` + `LintPanel.tsx` (call `trackChange`;
  per-change Approve)
- Modify the section-editor parent that renders MarkdownEditor + panels (owns `pending` state,
  "Approve all" button) — identify via `grep -l MarkdownEditor src/components/draft`.

## Task 1: `trackedChanges.ts` (TDD)

- [ ] **Step 1 — failing tests** (`tests/lib/trackedChanges.test.ts`):

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { approveAll, approveChange, loadPending, prunePending, trackChange } from "../../src/lib/trackedChanges";

beforeEach(() => localStorage.clear());

describe("trackedChanges", () => {
  it("records only the added runs of an edit", () => {
    trackChange("d1", "s1", "the cat sat", "the happy cat sat", "geo:bullets");
    const p = loadPending("d1");
    expect(p.map((c) => c.text.trim())).toEqual(["happy"]);
    expect(p[0].sectionId).toBe("s1");
  });
  it("approveChange removes one; approveAll clears", () => {
    trackChange("d1", "s1", "a", "a b", "x");
    trackChange("d1", "s2", "c", "c d", "y");
    const [first] = loadPending("d1");
    approveChange("d1", first.id);
    expect(loadPending("d1").map((c) => c.sectionId)).toEqual(["s2"]);
    approveAll("d1");
    expect(loadPending("d1")).toEqual([]);
  });
  it("prunePending drops runs no longer present in the section text", () => {
    trackChange("d1", "s1", "a", "a inserted", "x");
    prunePending("d1", [{ id: "s1", content_md: "a" }]);  // user deleted "inserted"
    expect(loadPending("d1")).toEqual([]);
  });
  it("no-throw when localStorage write fails", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("full"); };
    expect(() => trackChange("d1", "s1", "a", "a b", "x")).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
```

- [ ] **Step 2:** run → FAIL. **Step 3 — implement** using `wordDiff`:

```ts
import { wordDiff } from "./wordDiff";

export interface PendingChange { id: string; sectionId: string; text: string; source: string; }
const KEY = (d: string): string => `bf.pending.${d}`;
let _seq = 0;

export function loadPending(draftId: string): PendingChange[] {
  try { return JSON.parse(localStorage.getItem(KEY(draftId)) ?? "[]"); } catch { return []; }
}
function save(draftId: string, list: PendingChange[]): void {
  try { localStorage.setItem(KEY(draftId), JSON.stringify(list)); } catch { /* non-fatal */ }
}
export function trackChange(draftId: string, sectionId: string, before: string, after: string, source: string): void {
  const runs = wordDiff(before, after)
    .filter((p) => p.type === "add")
    .flatMap((p) => p.text.split(/\n+/))       // split multi-line adds so each matches per line
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (!runs.length) return;
  const existing = loadPending(draftId);
  save(draftId, [...existing, ...runs.map((text) => ({ id: `c${_seq++}`, sectionId, text, source }))]);
}
export function approveChange(draftId: string, id: string): void {
  save(draftId, loadPending(draftId).filter((c) => c.id !== id));
}
export function approveAll(draftId: string): void {
  try { localStorage.removeItem(KEY(draftId)); } catch { /* non-fatal */ }
}
export function prunePending(draftId: string, sections: { id: string; content_md: string }[]): void {
  const byId = new Map(sections.map((s) => [s.id, s.content_md]));
  save(draftId, loadPending(draftId).filter((c) => (byId.get(c.sectionId) ?? "").includes(c.text)));
}
export function pendingTextsFor(draftId: string, sectionId: string): string[] {
  return loadPending(draftId).filter((c) => c.sectionId === sectionId).map((c) => c.text);
}
```

- [ ] **Step 4:** tests PASS. Commit `feat(web): trackedChanges store (add-run diff tracker)`.

## Task 2: editor decoration (TDD-ish)

- [ ] **Step 1:** `MarkdownEditor` gains `pendingTexts?: string[]`. Add a ProseMirror plugin built
  from a `Decoration` set: walk `doc.descendants`, and for each text node, for each pending run
  (dedup + sort longest-first), find every substring occurrence and push
  `Decoration.inline(from, to, { class: "tracked-change" })`. Register it as an extension via
  TipTap's `Extension.create({ addProseMirrorPlugins() { return [plugin] } })`; rebuild the
  decoration set when `pendingTexts` changes (store the runs in a plugin `state`/`meta`, and call
  `editor.view.dispatch(tr.setMeta(pluginKey, texts))` in a `useEffect` on `pendingTexts`).
- [ ] **Step 2:** `index.css` — add `.tracked-change { color: var(--cobalt-700); text-decoration: underline; text-decoration-color: var(--cobalt-300); text-underline-offset: 2px; }` (reuse existing cobalt vars; confirm names in index.css).
- [ ] **Step 3 — test** (`tests/components/MarkdownEditor.tracked.test.tsx`, mirror the existing
  MarkdownEditor test setup): render with `initialMarkdown="the happy cat"` +
  `pendingTexts={["happy"]}`, assert a `.tracked-change` element exists containing "happy".
- [ ] **Step 4:** `npx vitest run` + `tsc` green. Commit `feat(web): tracked-change editor decoration`.

## Task 3: wire state into the section editor + "Approve all"

- [ ] **Step 1:** In the parent that renders `MarkdownEditor` per section (grep result from above),
  add `pending` state: `const [pending, setPending] = useState(() => loadPending(draftId))`; helper
  `refreshPending = () => setPending(loadPending(draftId))`. Pass
  `pendingTexts={pending.filter(c => c.sectionId === section.id).map(c => c.text)}` to each
  MarkdownEditor. After any `onSectionSave`, call `prunePending(draftId, sections)` then
  `refreshPending()`.
- [ ] **Step 2:** Render an "Approve changes (N)" button near the editor header when
  `pending.length > 0`: `onClick = () => { approveAll(draftId); refreshPending(); }`. Style with the
  existing ghost-button class.
- [ ] **Step 3:** tsc green. Commit `feat(web): pending-change state + Approve-all in the editor`.

## Task 4: instrument GEO + Lint apply paths + per-change Approve

- [ ] **Step 1 — GeoPanel:** at each point a fix computes `newContent` and calls
  `onSectionSave(sid, newContent)`, capture the prior `section.content_md` and call
  `trackChange(draft.id, sid, before, newContent, "geo:" + fix)` immediately after, then
  `refreshPending` (thread a callback prop `onPendingChange` from the parent, or call the parent's
  refresh via the same prop that owns pending). For additive fixes (faq/table/opener/takeaways) the
  before is the pre-append content, after is with the block — the diff yields the appended block as
  the run.
- [ ] **Step 2 — GeoPanel per-change Approve:** each applied-fix row (the ones that already show
  Undo) gets an **Approve** button → `approveChange(draft.id, <its change ids>)`. Map an applied fix
  to its change ids by remembering them when `trackChange` ran (return the created ids from
  `trackChange` and stash them on the applied-fix record). If that's heavy, approximate: Approve on a
  row calls `prunePending`+ nothing (rely on Approve-all + self-edit) — but the approved design wants
  per-change, so return ids from `trackChange` and store them.
- [ ] **Step 3 — LintPanel:** same instrumentation on its AI-fix apply path.
- [ ] **Step 4:** vitest (add a GeoPanel test asserting `trackChange` is called with before/after —
  mock `../../lib/trackedChanges`) + tsc green. Commit
  `feat(web): track GEO + Proofreader fixes as pending changes with per-change approve`.

## Task 5: verification

- [ ] `npx vitest run` (full) + `npx tsc --noEmit` + `npx biome check` on touched files → green.
- [ ] Manual note in PR: rich mode colors changes; raw mode shows the count note; Undo still works.
- [ ] Push; PR `feat(web): tracked-changes color for panel-applied edits` (base `feat/geo-enhancements`).

## Self-review

- **Spec coverage:** all-panel-fixes (Task 4 GEO+Lint) ✓; per-change + approve-all (Task 3 + Task 4
  Step 2) ✓; self-edit clears (prunePending in Task 3 Step 1) ✓; colored+underline not red (Task 2
  CSS) ✓; clean markdown (tracker is localStorage-only, never mutates content) ✓; raw-mode note
  (Task 2 Step 1) ✓.
- **Type consistency:** `PendingChange{id,sectionId,text,source}`, `trackChange(draftId, sectionId,
  before, after, source)`, `pendingTextsFor` / `loadPending` used consistently across tasks.
- **Return-ids note:** Task 4 Step 2 requires `trackChange` to return the created change ids for
  per-change approve — adjust the Task 1 signature to `trackChange(...) : string[]` (return the new
  ids) so the panel can map a fix-row → its change ids. (Applied to the Task 1 impl: collect and
  return the ids instead of nothing.)
