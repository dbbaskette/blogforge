# Checkup review standardization

Date: 2026-07-15
Status: Approved, ready for implementation plan

## Problem

Checkup fronts four analysis passes — Proofread (lint), GEO readiness, Suggestions
(Shape), and Humanness (Humanize). The detail panels are where fixes get applied, and
they do not behave alike. A writer who learns how to act on a GEO finding has to
re-learn it for Humanize, and again for Shape.

The 2026-07-02 GEO/Optimize pass unified GEO and Proofread onto a shared issue model
(`Issue`, `IssueCard`, `useIssueLifecycle`, `FixPreviewModal`) so "behaviour can't
diverge again". Humanize later joined. That unification is real but incomplete:

**Of the four panels Checkup opens, only two are on the shared model.**

| Checkup row | Opens | On shared model? |
|---|---|---|
| Proofread | `LintPanel` | **No** |
| GEO readiness | `OptimizePanel` → `GeoReviewRail` | Yes |
| Suggestions | `ShapePanel` | **No** |
| Humanness | `HumanizePanel` → `HumanizeReviewRail` | Yes |

Specific defects:

1. **Proofread is implemented twice.** `LintPanel` is the standalone panel Checkup opens
   (`DraftWorkspace.tsx:607` → `setLintOpen(true)`) and is not on the shared model.
   `ProofreadReviewRail` is a *second* proofread implementation that exists only as a tab
   inside `OptimizePanel` ("GEO / Proofreading / All") and *is* on the shared model. Two
   code paths for one feature.
2. **Shape never joined.** `ShapePanel` is wholly separate: own cards, own dismiss store,
   own `inlineEdit` apply path, and no undo and no review state at all.
3. **Four dismissal stores, two meanings.** `bf.lint.dismissed.*` (LintPanel),
   `bf.humanize.dismissed.*` (Humanize), `bf.shape.dismissed.*` (Shape) all hide the card;
   `bf.review.status.*` (the lifecycle's `dismiss` → `accepted`) turns it green with Undo.
4. **The `why` line is fed inconsistent data.** GEO sets `why = lever.detail`, already
   rendered at the group header — hence the `showWhy={false}` escape hatch. Humanize sets
   `why = f.note` *and* `title = f.note`, so those cards print the same sentence twice.
   Proofread sets static boilerplate ("A voice-rule violation to clean up.") on every card.
5. **`IssueCard` is not panel-neutral.** It hardcodes a `GEO:` prefix on the impact line.
6. **Rail structure diverges.** GEO groups by lever with a score bar; Humanize by lens
   with a label; `ProofreadReviewRail` is a flat list; Shape groups by kind.

The panel headers (GEO's tabs and score, Humanize's graphs and pulse, LintPanel's
humanity score, Shape's hint) are fine and stay panel-specific. Everything from the
suggestion list down must match.

## Decisions

| Decision | Choice |
|---|---|
| Scope | All four Checkup panels |
| Proofread duplication | Port `LintPanel` onto the shared rail; delete `ProofreadReviewRail`; OptimizePanel's Proofreading tab renders the shared rail |
| Dismiss | Universal, persistent, one shared store; dismissed items hide behind an `N dismissed — show` toggle |
| Rail | One shared `ReviewRail`; group header is a pluggable slot |
| `why` line | Rendered only when it adds information; `showWhy` prop deleted |
| Shape's "pick one of N" | Extend `Issue` with `options[]` + a `choose_option` action |
| Issue id stability | Fixed in this change (content-hashed ids) |

Note: `LintPanel` already implements the chosen dismiss UX — `showDismissed` state, a
`Show/Hide dismissed (N)` toggle, and `restore()` (`LintPanel.tsx:177-329`). That is the
proven in-repo precedent; `ReviewRail` lifts it rather than inventing it.

## Design

### 1. Model (`lib/issues/types.ts`)

- `panel` union gains `"shape"`.
- `options?: string[]` — concrete alternatives the writer picks between. Shape's `reword`
  supplies rewrites; `expand` supplies ideas.
- `IssueAction` gains `choose_option`.
- `impactLabel?: string` — replaces the hardcoded `GEO:` prefix. GEO's adapter supplies
  `"GEO"`; other panels supply nothing and render the impact unprefixed.
- `why` keeps its meaning but tightens: a genuine per-finding rationale, or omitted.
  Adapters must not echo the title or the group detail into it.

### 2. `components/review/ReviewRail.tsx` (new)

The single findings list for all four panels. Absorbs `GeoReviewRail`,
`HumanizeReviewRail`, `ProofreadReviewRail`, LintPanel's list body, and ShapePanel's list
body. Owns grouping, dismissal filtering and the show-dismissed toggle, the busy overlay,
the preview modal, the empty state, and the `why` dedupe rule.

```ts
interface ReviewGroup {
  key: string;
  label: string;
  /** Group-level prose. Used as a header line and as the why-dedupe basis. */
  detail?: string;
  /** Pluggable header content (GEO's score bar, Humanize's lens label). */
  header?: ReactNode;
}

interface ReviewRailProps {
  issues: Issue[];
  groups: ReviewGroup[];      // order is render order; empty groups are skipped
  draftId: string;
  apply: UseIssueLifecycleArgs["apply"];
  save: UseIssueLifecycleArgs["save"];
  onHighlight?: UseIssueLifecycleArgs["onHighlight"];
  onRescore?: (lever: string) => void;
  onRestoreLever?: (lever: string) => void;
  emptyState: ReactNode;
  headerSlot?: ReactNode;     // GEO's "How these rules work →"
  actionLabels?: Partial<Record<IssueAction, string>>;
}
```

Each panel keeps a thin wrapper that builds `issues` (via its adapter) and `groups`, and
supplies `apply`/`save`. Panels keep their own headers; only the list body swaps.

Grouping per panel: GEO by lever (score-bar header), Humanize by lens (label header),
Proofread by the adapter's existing `lever` field (`f.rule || f.kind`), Shape by kind.

### 3. Proofread de-duplication

- `LintPanel` keeps its header, humanity score, `onTrackChange` wiring, and its Checkup
  entry point; its findings list becomes `<ReviewRail>` fed by `proofreadFindingsToIssues`.
- `ProofreadReviewRail` is deleted. `OptimizePanel`'s Proofreading tab renders the same
  `<ReviewRail>` with the same adapter, so both surfaces are one code path.
- `proofreadApply.ts` is the shared apply for both surfaces (it already exists).

### 4. Dismissals (`lib/issues/dismissals.ts`, new)

One store: `bf.review.dismissed.${draftId}` → `string[]` of issue ids. Ids are
panel-namespaced (`geo:*`, `humanize:*`, `pf:*`, `shape:*`), so one store is unambiguous.

- Replaces `lib/lintDismissals.ts`, `lib/humanizeDismissals.ts`, and ShapePanel's inline
  `bf.shape.dismissed.${draftId}`.
- API mirrors the existing modules so the port is mechanical:
  `loadDismissed(draftId)`, `dismiss(draftId, id)`, `restore(draftId, id)`.
- **No migration from the legacy stores.** Section 8 re-keys every issue to a
  content hash, so legacy entries could not match a current issue id even if copied
  across — a migration would be dead code that silently does nothing. (The lint store is
  doubly incompatible: it keys on bare `f.id`, not the namespaced `pf:${f.id}`.) Existing
  dismissals are therefore lost once, on upgrade; the writer re-dismisses. This is a
  deliberate trade for ids that are correct going forward. The legacy keys are left in
  place, unread, rather than deleted.
- `dismiss` leaves the lifecycle's status path: `useIssueLifecycle.run` drops its
  `action === "dismiss"` branch; the rail handles dismiss directly.
- The rail filters dismissed issues out and renders one `Show/Hide dismissed (N)` toggle
  per rail (not per group), lifted from `LintPanel`. Revealed cards render normally with
  a `Restore` control.

This preserves the intent behind the hide-style stores (a dismissed finding stays gone
across re-analysis) while giving every panel the reversibility LintPanel already has.

### 5. The `why` rule

`IssueCard`'s `showWhy` prop is deleted. `ReviewRail` computes the display value:

> render `why` only when it is non-empty **and** not equal (trimmed, case-insensitive) to
> the issue's `title` **and** not equal to its group's `detail`.

The rail passes the resolved issue down; `IssueCard` renders `issue.why` when present.
The rule is data-driven, so no panel can opt out and drift.

Adapter cleanups that follow:
- Humanize: stop setting `why = f.note` when `title` is the same text.
- Proofread: drop the static boilerplate. Real per-rule copy is out of scope; absent is
  better than noise.
- GEO: data unchanged (`why = lever.detail`); the dedupe rule hides it automatically,
  which is what `showWhy={false}` was hand-coding.

### 6. Shape port

**`lib/issues/shapeAdapter.ts`** — `SuggestResult` (`Partial<Record<SuggestKind,
Suggestion[]>>`, `Suggestion { target, note, options }`) → `Issue[]`, grouped by kind:

| Kind | nature | actions | options |
|---|---|---|---|
| `reword` | `fix` | `choose_option`, `manual_fix`, `highlight`, `dismiss` | the alternatives |
| `expand` | `add` | `choose_option`, `write_own`, `dismiss` | the ideas |
| `fact_check` | `advisory` | `highlight`, `dismiss` | — |

**`lib/issues/shapeApply.ts`** — an `apply` matching the lifecycle contract:
- `choose_option` on `reword`: splice the chosen option over `target` client-side, no
  model call.
- `choose_option` on `expand`: `inlineEdit` with the chosen idea, then splice.
- Honors `opts.persist === false` so the preview modal can show before/after without
  saving.

Shape thereby gains the review state, undo, per-card error surfacing, and the preview
modal — none of which it has today.

### 7. `IssueCard` option chips

When an issue carries `options` and a `choose_option` action, the card renders the
alternatives as chips. Selecting one calls `onAction("choose_option", option)`, which
routes through the same `requestPreview` → `FixPreviewModal` → `confirmPreview` path as
every other AI fix.

### 8. Issue id stability

GEO and Humanize ids are position-based (`${lever.key}:${i}`,
`humanize:${lens}:${section}:${i}`). A re-analysis returning a different finding count
shifts those indices, so a persisted status or dismissal can attach to a *different*
finding. (Proofread is already stable — `pf:${f.id}` keys off a backend id — and Shape's
new ids must be built stable from the start.)

This bug exists now, but hide-on-dismiss makes it materially worse: today a
mis-attribution surfaces as a visibly-green card you can undo; with hiding, the wrong
card silently disappears.

Fix: derive ids from stable content rather than position, via one shared helper in
`lib/issues/issueIds.ts` — `${panel}:${lever}:${hash(sectionId + target + title)}`, using
a simple deterministic string hash (no new dependency). Collisions within one report fall
back to appending an index.

Pre-existing persisted decisions keyed by the old ids are dropped on upgrade. That is
acceptable: the alternative is honoring ids we know can be wrong.

## Data flow

```
report ──adapter──> Issue[] ──(GEO: fillSectionIds)──> ReviewRail
   └─> filter dismissed ─> group ─> resolve display `why` ─> IssueCard
          └─ onAction ─> useIssueLifecycle (apply | requestPreview)
                └─ FixPreviewModal ─> confirmPreview ─> save ─> highlight / rescore
```

## Error handling

Unchanged and now universal: `useIssueLifecycle` catches apply failures, surfaces the
message on the originating card, and leaves the issue open. Shape's and LintPanel's
ad-hoc error handling folds into this, so a failed apply stops being a silent no-op.

## Testing

New:
- `ReviewRail.test.tsx` — grouping and group order, empty groups skipped, empty state,
  dismiss filtering, the show-dismissed toggle and restore, the `why` dedupe rule
  (hidden when equal to title, hidden when equal to group detail, shown otherwise).
- `shapeAdapter.test.ts` — each kind's nature/actions/options mapping.
- `shapeApply.test.ts` — reword splice, expand via `inlineEdit`, `persist: false`
  computes without saving.
- `dismissals.test.ts` — single store round-trip (dismiss / restore / load), and that a
  dismissed id survives a reload.
- `issueIds.test.ts` — the same finding yields the same id across reports with differing
  finding counts; collisions disambiguate.
- `IssueCard` — option chips render and dispatch `choose_option`.

Updated: `GeoReviewRail.test` and `SectionsPanel.test`/`OptimizePanel.test` retarget the
new rail; LintPanel's tests retarget its new list body.

Removed: `lib/lintDismissals.ts` + `tests/lib/lintDismissals.test.ts`,
`lib/humanizeDismissals.ts` + `tests/lib/humanizeDismissals.test.ts`,
`components/draft/ProofreadReviewRail.tsx` + its test.

## Out of scope

- Rewriting Proofread's per-rule explanation copy.
- Changing any panel header, graph, or score computation.
- Backend/API changes. This is entirely a `packages/web` refactor.
- The GEO rescore mechanics (`onRescore`/`onRestoreLever`), which pass through the rail
  unchanged.
- `CheckupPanel` itself — it is a summary/triage surface, not a fix surface, and its rows
  keep their current routing.
