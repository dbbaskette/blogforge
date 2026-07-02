# GEO + Proofreader Review UX — Unified Optimize Mode (Design)

**Goal:** Replace today's inconsistent, cramped GEO/Proofreader panels with one consistent, roomy review experience: every issue is an individually-actionable card with the same lifecycle (red → review → green), the same adaptive actions (AI Fix / Manual Fix / Highlight / Generate / …), per-issue undo, and a live score — all in a dedicated two-pane "Optimize" mode where the editor and the issues sit side by side.

**Status:** Approved in brainstorming. Ready for implementation planning.

---

## 1. Problem

The GEO Optimizations feature accreted across ~15 PRs and is now a hodge-podge:

- **~5 different fix models** across 12 levers: AI rewrite (`inlineEdit`), deterministic (dedupe), additive generate-and-insert (opener/FAQ/table), user-supplied data (factual density "Add data"), and flag-only (no fix).
- **3 levers built on the backend but never wired to any UI:** Citations (cite/quote a source), Key-takeaways, and image Alt-text.
- **Findings never resolve visibly** — nothing turns green when fixed; only an "Undo" button appears. Flag-only levers (brand, freshness, first-hand signal) nag forever with no way to clear them.
- **Cramped, editor-blocking layout:** both panels are `fixed right-0 … w-[460px]` slide-over drawers that overlay the very editor text they're trying to highlight. No room for inline editors, before/after, or breathing space.
- Multi-issue levers report several findings but they aren't presented as independently-editable items in a consistent way.

## 2. Approved decisions (from brainstorming)

1. **Same card, adaptive actions.** Every issue uses one card skeleton and lifecycle; the action buttons adapt to the issue's nature.
2. **Apply → review → accept lifecycle.** A fix applies immediately and is highlighted in the draft; the card enters a review state with Accept + Undo on it; Accept turns it green. This folds the tracked-changes approval *into each card*.
3. **Manual Fix = inline editor on the card** (pre-filled with the flagged passage, or blank for add-missing), routed through the same review → accept flow.
4. **Scope: GEO + Proofreader unified** under the same model in one effort.
5. **Structure: shared card + lifecycle, panels keep their identity** (Approach A) — not a big-bang merge into one list.
6. **Score moves on apply, locks on accept, restores on undo.**
7. **Layout: dedicated two-pane Optimize mode** — editor left, issues rail right, nav collapsed, unified score + segmented (All / SEO / Proofreading) header.

## 3. The unified Issue model

Every finding from either panel maps to a normalized shape:

```ts
type IssueNature = "fix" | "add" | "advisory";
type IssueStatus = "open" | "review" | "accepted";
type IssueAction =
  | "ai_fix" | "manual_fix" | "highlight"        // fix-passage
  | "generate" | "write_own"                     // add-missing
  | "cite_source" | "quote_source"               // citations
  | "add_fact" | "add_date"                       // user-supplied data
  | "dedupe" | "dismiss";                        // deterministic / advisory

interface Issue {
  id: string;                 // stable per finding
  panel: "geo" | "proofread";
  lever: string;              // e.g. "answer_first", "citations", "grammar"
  title: string;              // short: "This section buries its answer"
  why: string;                // plain-language rationale
  nature: IssueNature;
  sectionId: string;          // or "opening" for the lede
  target?: string;            // flagged passage (fix issues); absent for add/advisory
  actions: IssueAction[];     // which controls this card shows
  status: IssueStatus;        // open | review | accepted
}
```

Multi-issue levers (answer-first, factual density, citations, skimmability, chunking) produce **one `Issue` per instance**, each independently actionable.

## 4. Card + lifecycle

Card skeleton (identical for every issue): status dot + status label + title · plain-language "why" · flagged passage (fix issues) · adaptive action row.

Lifecycle:

- **Open (red border).** Action row offers the fix(es) for this issue's nature.
- **Review (amber border).** After a fix is triggered, the change is applied to the section and **highlighted in the draft** (see §7). Card shows **Accept** + **Undo**. The lever + overall score re-score immediately (§6).
- **Accepted (green border).** Collapses to a slim done row with a quiet **Undo**. The "N of M resolved" counter advances.

**Undo is universal:** reverts the content change, re-scores, returns the card to Open (or removes a generated block). The per-issue undo ledger persists in localStorage so undo survives a reload within a session.

Accepted (green) issues remain listed as "done" until the next **full** re-scan, which drops resolved issues.

## 5. Per-lever mapping

| Lever | Nature | Multiple cards? | Actions | Newly wired |
|---|---|---|---|---|
| Answer-first sections | fix | yes (per weak section) | AI Fix · Manual · Highlight | |
| Factual density — thin spot | fix | yes | Add a fact · Highlight | |
| Factual density — fluffy/buzzwords | fix | yes | AI Fix (tighten) · Manual · Highlight | |
| Citations | fix | yes (per uncited claim) | Cite a source · Quote a source · Highlight | ✅ |
| Question headings | fix | yes (per heading) | AI Fix · Manual · Highlight | |
| Skimmability — dense wall | fix | yes (per paragraph) | AI Fix (bulletize) · Manual · Highlight | |
| Skimmability — empty alt text | fix | yes (per image) | Generate alt · Write my own · Highlight | ✅ |
| Chunking — backref / too long / too short | fix | yes (per instance) | AI Fix · Manual · Highlight | |
| Definitional opener | fix or add | add / improve / dedupe | Generate · Write my own · AI Fix / dedupe | |
| Brand not explicit | fix | usually one | AI Fix (name it early) · Manual · Highlight | ⬆ from flag-only |
| FAQ | add | one | Generate · Write my own | |
| Key-takeaways | add | one | Generate · Write my own | ✅ |
| Comparison table | add | one per section | Generate · Write my own | |
| Freshness | advisory | one | Add a date · Highlight · Dismiss | ⬆ from flag-only |
| Factual density — no first-hand signal | advisory | one | Highlight · Dismiss | |

**Advisory flavor:** guidance that can't be auto-fixed without fabricating (freshness, first-hand signal) renders as a neutral (not-red) card with **Dismiss** ("handled / not applicable" → green) plus a Manual path to supply a real date/fact. This gives flag-only levers a way to be resolved instead of nagging.

**Proofreader findings** (grammar, style, banished words, em-dash, etc.) map mostly to `nature: "fix"` with AI Fix / Manual / Highlight.

## 6. Score mechanics

- The score always reflects the **current draft**.
- On **apply** (entering review) the affected lever is re-scored via the existing targeted `POST /geo/rescore` path (debounced ~900ms); the per-lever bar and overall score move immediately.
- **Accept** locks the card green — no re-score needed (content already scored).
- **Undo** reverts content → re-scores that lever → restores the number → card back to Open.
- Overall score keeps the existing present-weight-normalized average formula. "N of M resolved" is derived from card statuses.
- Proofreader has no numeric score today; it keeps its existing summary but gains the same per-issue green/undo behavior.

## 7. Editor highlighting

Extend the existing `trackedChangeDecoration` (TipTap/ProseMirror) to support two decoration kinds, both keyed off text ranges via the current text-match approach:

- **under-review** — amber highlight of a just-applied change (shown while a card is in `review`).
- **locate** — transient highlight from the **Highlight** action; scrolls to and briefly highlights the target passage without changing state.

The old "Approve changes (N)" localStorage tracked-changes approve flow is **replaced** by per-issue accept (the card is the approval). An optional "Accept all" affordance may accept every card currently in `review`.

## 8. Architecture (Approach A — shared core, panels keep identity)

Shared, well-bounded units:

- **`Issue` model** (§3) — the normalized shape both panels map to.
- **`<IssueCard>`** — pure presentation; renders any `Issue` in any state with the adaptive action row. No business logic.
- **`useIssueLifecycle`** — the single state machine (apply → review → accept → undo) plus effects (editor highlight, targeted re-score). Both panels run through it so behavior cannot diverge again.
- **Action adapters** — one small function per `IssueAction`, each wrapping an existing backend endpoint and returning `{ before, after, apply, revert }`:
  `aiRewrite` (`/inline`), `generateInsert` (`/geo/opener|faq|table|takeaways|alt`), `manualEdit`, `citeSource`/`quoteSource` (`/geo/cite`, `/geo/quotes`), `addFact`/`addDate`, `dedupe`, `dismiss`.
- **Editor highlight extension** (§7).
- **Panel adapters** — `geoFindingsToIssues(report)` and `proofreadFindingsToIssues(lint)` translate raw findings → `Issue[]`.

**Decomposition:** `GeoPanel.tsx` (~1050 lines) is split into the shared core + a thin GEO adapter; `LintPanel` becomes a thin Proofreader adapter. This is a deliberate, in-scope cleanup — the tangled single file is the root of the current inconsistency.

## 9. Layout — two-pane Optimize mode

Entering optimization switches the workspace into a purpose-built split (not an overlay drawer):

- **Slim top header:** back/exit, "Optimize", "N of M resolved", overall score chip, **All · SEO · Proofreading** segmented control, Done.
- **Left pane (~55–60%):** the draft, fully visible; under-review and locate highlights land here.
- **Right pane (~40–45%):** the issues rail — a scroll of `<IssueCard>`s grouped by lever, filtered by the segmented control.
- The existing 220px nav rail collapses to an icon rail to reclaim width.

Small viewports fall back to a stacked/toggle layout (issues above/below the draft) — the split is a wide-screen enhancement, not a hard requirement.

## 10. Non-goals (YAGNI)

- No merge of GEO + Proofreader into a single score or a single undifferentiated list (rejected Approach B).
- No global multi-step undo/redo stack — per-issue undo only.
- No new persistence of "green" state server-side; resolved issues simply don't reappear on the next full scan.
- No change to the GEO scoring model / weights, or to the backend detection logic, beyond wiring the three dead endpoints.
- Mobile gets a functional stacked fallback, not a bespoke mobile optimize mode.

## 11. Testing

- **Unit:** `useIssueLifecycle` transitions (open→review→accept→undo); each action adapter's `{before,after,apply,revert}`; `geoFindingsToIssues` / `proofreadFindingsToIssues` mappers; score recompute.
- **Component (vitest + testing-library):** `<IssueCard>` shows the right actions per nature/state; AI Fix → review; Accept → green; Undo → open; advisory Dismiss → green.
- **Backend:** tests for the three newly-wired endpoints (takeaways, alt, cite/quote) where missing.
- **Keep** existing GEO scoring tests green.

## 12. Rollout phasing

1. **Shared core** — `Issue` model, `<IssueCard>`, `useIssueLifecycle`, action adapters, editor-highlight extension (with tests). No panel visible change yet.
2. **GEO adapter** — reduce `GeoPanel` to `geoFindingsToIssues` + `<IssueCard>` via the hook; preserve current levers' behavior on the new model.
3. **Two-pane Optimize mode** — the layout shell (header, collapsed nav, split panes), hosting the GEO adapter.
4. **Wire the three dead levers** — Citations (cite/quote), Key-takeaways, Alt-text; upgrade Brand + Freshness to real actions; add the advisory Dismiss.
5. **Proofreader adapter** — `proofreadFindingsToIssues` into the same rail under the segmented control; retire the standalone "Approve changes" flow.

Each phase ships green and is independently testable.

## 13. Open questions

- None blocking. Score-on-apply (vs on-accept) is chosen; revisit only if the pre-accept score jump feels premature in use.
