# Tracked-changes color for panel-applied edits — design

**Goal:** when the writer applies a suggestion from the Improvements panels (GEO optimizer, Proofreader)
or any panel-applied edit, the **added/modified words render in a distinct color** in the editor —
so what changed is obvious at a glance without jumping from the panel. Approving (per-change or
all) returns the text to the normal color. Saved markdown stays clean.

**Status:** design approved 2026-07-02. Scope = **all panel-applied fixes**; approval = **per-change
+ Approve-all** (and editing the colored text yourself clears it). Visual = colored text + faint
underline (not a background highlight, not error-red — a "this was AI-changed" cobalt).

## Principle: track the added runs, keep the markdown clean

Every fix already flows through `onSectionSave(sectionId, newContentMd)` (GeoPanel) or the equivalent
save in LintPanel/inline edits — always with the **before** and **after** text in hand. One utility
diffs them and records only what was *added*:

`trackChange(draftId, sectionId, before, after, source)` → runs the existing
`wordDiff(before, after)` (`src/lib/wordDiff.ts`), keeps the `add` runs (≥1 non-space char), and
appends them to a per-draft localStorage tracker `bf.pending.{draftId}`:

```ts
interface PendingChange { id: string; sectionId: string; text: string; source: string; }  // source: "geo:bullets" | "lint:fix" | …
```

This mirrors the existing `bf.geo.additions.{draftId}` pattern — content on disk/in the DB never
carries markers, so exports, lint, and GEO scoring all see clean text.

## Rendering: a TipTap decoration layer (view-only, no content mutation)

`MarkdownEditor` gains a `pendingTexts: string[]` prop (the tracked `text` runs for the section it's
editing). A small ProseMirror plugin walks the doc's text nodes and adds an **inline Decoration**
(`class="tracked-change"`) over every occurrence of a pending run. Pure view chrome — it never edits
the document, so autosave/turndown round-trips are untouched. CSS: `.tracked-change { color:
var(--cobalt-700); text-decoration: underline; text-decoration-color: var(--cobalt-300);
text-underline-offset: 2px; }`. Raw (markdown) mode can't decorate a textarea, so it shows a subtle
"N pending changes — switch to rich to see them highlighted" note instead.

Matching is literal-substring over the plain text of the section (the same text the runs were lifted
from), longest-first so overlapping runs don't double-wrap. Runs are split on newlines when stored
so a multi-paragraph addition matches reliably per line.

## Approval: three ways back to normal

1. **Per-change ✓** — each applied-fix row in GeoPanel/LintPanel that produced a tracked change shows
   an **Approve** action next to the existing **Undo**. Approve removes just that change's tracker
   entries (its runs) → those words de-color; Undo keeps working as today (reverts the edit *and*
   drops the tracker entry).
2. **Approve all** — a small "Approve changes (N)" button rendered near the editor header whenever the
   draft has pending changes, so you can finalize without opening a panel. Clears `bf.pending.{draftId}`.
3. **Edit it yourself** — a prune pass (`prunePending(draftId, sections)`) drops any run no longer
   present in its section's text; touching the colored text naturally finalizes it. Runs on draft
   load and after each save (same trigger the additions-carve already uses).

## Data flow

```
apply fix → onSectionSave(sid, after)               (unchanged)
         → trackChange(draftId, sid, before, after, source)   (new: store add-runs)
DraftEditor passes pending[sid].map(c=>c.text) → MarkdownEditor.pendingTexts
MarkdownEditor decoration plugin colors those substrings
Approve ✓ / Approve all / self-edit → remove runs → re-render → color clears
```

The editor's parent (the section editor / DraftEditor) owns the `pending` state (loaded via
`loadPending`), passes each section its runs, and re-reads after saves/approvals. `trackChange` and
approvals write localStorage + bump that state.

## Scope of instrumented apply paths

- **GEO fixes** (GeoPanel): the section-rewriting fixes — `question_heading`, `bullets`,
  `self_contained`, `answer_first`, `definitional*`, `dedupe_opening` — and the additive ones
  (`faq`, `comparison_table`, `opener`, plus GEO-1..5's `takeaways`, `cite_reference`,
  `quote_reference`): all end in an `onSectionSave`/updateDraft with before+after → all call
  `trackChange`. Additive fixes track the appended block as the added run.
- **Proofreader fixes** (LintPanel): the one-click AI fix path → `trackChange`.
- (Inline select-text edits are out of scope per the approved answer — the writer watched those happen.)

## Error handling / edges

- Whole-section rewrite colors only the genuinely-changed words (that's what the diff yields), not the
  whole body.
- localStorage disabled/full → `trackChange` no-ops in a try/catch (like `saveAdditions`); the edit
  still applies, just uncolored.
- A run that appears verbatim elsewhere in the section (coincidental match) may over-color a few
  words — acceptable; approval/self-edit clears it. We do not attempt position-exact offsets (the
  content re-renders through markdown, so character offsets aren't stable).

## Testing

- `src/lib/trackedChanges.ts` (vitest): `trackChange` records add-runs from a before/after; approve
  removes one; approveAll clears; `prunePending` drops absent runs; localStorage-off no-throw.
- MarkdownEditor decoration: a small test that with `pendingTexts=["added words"]` the rendered
  editor contains a `.tracked-change` span around them (jsdom + the existing editor test harness).
- GeoPanel: applying a fix calls `trackChange` with the pre/post content (mock the lib, assert args).

## Out of scope

- Deleted-text strikethrough (we color additions/modifications, per the ask — "added/modified text").
- Server-side persistence of pending state (localStorage per-draft is enough; it's a review aid).
- Inline select-text AI edits (excluded above).
