# Non-blocking GEO rescores + collateral-drift fix — design

**Date:** 2026-07-09
**Status:** Approved (user), pending implementation
**Scope:** Stop the Optimize panel from blocking on every GEO rescore, and
refresh collateral structural levers a fix moves — without any client-side
duplication of the scoring engine.

## Context

Applying a GEO fix in the Optimize panel re-scores the affected lever and
merges the fresh score back in. The math is already incremental: the total is
a pure weighted mean with no cross-lever dependencies (`build_report`,
`generate/geo.py:1187`; mirrored client-side by `computeTotalScore`,
`web/src/components/draft/geoScore.ts`), and each lever carries its own
`weight` so the client recomputes the total from whatever levers it has.

Two problems remain:

1. **It blocks.** `flushRescore` already runs the rescore as a background
   promise, but `OptimizePanel.tsx:268` throws a full-panel `BusyOverlay`
   (`{rescoring && <BusyOverlay …/>}`) over the whole panel while *any*
   rescore is in flight — including the multi-second semantic LLM pass
   (`_run_semantic` → `provider.complete`, `generate/geo.py:1222`). The
   overlay, not the network, is what makes the user wait.

2. **Collateral drift.** The rescore only refreshes the *one* lever tagged on
   the fixed issue (`useIssueLifecycle.ts` → `onRescore(issue.lever)` →
   `queueRescore`). But a single edit often moves other levers too — adding a
   citation link moves `factual_density`; rewriting a section for
   `answer_first` moves `skimmability`, `chunking`, `page_front_load`. Those
   stay stale until a manual Re-analyze.

Confirmed scoring split (`generate/geo.py:1200-1219`): 10 **structural** levers
recompute deterministically from the markdown via `score_structural`
(`geo.py:460`, pure regex, no LLM); 17 **semantic** levers come from one LLM
pass. `score_structural` already computes all 10 on every rescore call; the
route just doesn't return them all.

### Design decisions (from brainstorming)

- **Structural: hide latency, don't port.** Keep `score_structural` server-side
  only — no TypeScript reimplementation. A ~100ms round-trip is imperceptible
  once nothing blocks; duplicating ~250 lines of regex across Python and TS is
  not worth the drift risk.
- **All rescores become non-blocking** background operations with an
  "updating" affordance per lever.
- **Pending UI: honest "updating" state.** No optimistic/estimated scores — the
  affected lever shows a small "updating…" pill and its score updates in place
  when the real result lands. The total is never a guessed number.
- **Fix collateral drift now,** for free, by widening the rescore response.

## Part 1 — Non-blocking Optimize panel (`OptimizePanel.tsx`)

The rescore is already async; the block is purely presentational.

1. **Remove the `BusyOverlay`** at `OptimizePanel.tsx:268`. That line is the
   entire block.
2. **Replace the global `rescoring: boolean`** (`OptimizePanel.tsx:73`) with an
   **`inFlight: Set<string>`** of the lever keys the user's fixes actually
   queued. `flushRescore` adds its `keys` to `inFlight` on start and removes
   them in `finally` (using the functional `setInFlight` form so overlapping
   flushes don't clobber each other). Track only the *requested* keys, not the
   collateral levers returned by Part 2 — the pill marks what the user acted
   on, and the slow case (semantic) is always a requested key.
3. **Thread `inFlight` down** through `GeoReviewRail` to the per-lever card; the
   card renders a small "updating…" pill when `inFlight.has(lever.key)` and
   leaves the rest of the card fully interactive.
4. **Drop the banner** at `OptimizePanel.tsx:418-422` (the per-card pill
   replaces it). The initial-scan affordance (`busy && !report` →
   "Scoring your draft…", line 415-416) is unchanged.
5. The existing merge — `prev.levers.map(l => fresh[l.key] ?? l)` then
   `computeTotalScore` (`OptimizePanel.tsx:169-173`) — already tolerates a
   `fresh` set wider than the request, so Part 2 needs **zero** client change.

Debounce (900ms), the pre-fix `leverSnapshots` undo path, and `restoreLever`
are untouched.

## Part 2 — Refresh collateral structural drift (`rescore_geo`, `geo.py:1287`)

Always run `score_structural(draft)` and return **all structural levers except
`faq`**, plus any explicitly requested levers (including `faq` when requested),
plus the requested semantic lever(s):

```python
want = {k for k in keys if k in _ORDER}
out: dict[str, dict[str, Any]] = {}
structural = score_structural(draft)                      # cheap regex, always
auto = (_STRUCTURAL_KEYS - {"faq"}) | (want & {"faq"})
out.update({k: structural[k] for k in auto if k in structural})
if want & _SEMANTIC_KEYS:
    semantic = await _run_semantic(draft, pack_root, provider,
                                   model=model, extra_sources=extra_sources)
    out.update({k: semantic[k] for k in want & _SEMANTIC_KEYS if k in semantic})
return out
```

`score_structural` now runs even for a purely semantic fix (so structural drift
from a semantic rewrite is captured) — negligible cost, no I/O. The route's
background-context gate is **unchanged**: `api/geo.py:109-113` still builds `bg`
only when a semantic lever is requested, so structural-only fixes pay nothing
extra.

### Why `faq` is excluded

`faq`'s findings carry semantic sub-question *coverage* advisories
("Not covered: …") that only the full semantic pass produces and merges
(`analyze_geo`, `geo.py:1278-1283`); `rescore_geo` has no coverage data.
Auto-refreshing `faq` structurally on every fix would clobber those advisories
until the next Re-analyze. Excluding it preserves them with zero special-casing;
`faq` still refreshes when a FAQ fix explicitly targets it (today's behavior),
and its structural score rarely drifts from non-FAQ edits. Coverage feeds only
the findings *count* (`countGeoFixes`, `checkup.ts:55`), never a numeric score,
so the total stays correct either way.

## Testing

- **Backend** (`rescore_geo` tests): a single-structural-key rescore returns all
  9 non-`faq` structural levers; `faq` is absent unless explicitly requested and
  present when it is; a semantic-key rescore returns that semantic lever *and*
  the 9 structural levers; requesting only semantic still triggers
  `score_structural`.
- **Frontend**: `geoTotalScore.test.ts` already pins the weighted-merge math
  (unchanged). Add coverage that `inFlight` gains the flushed keys on start and
  clears them on resolve, and that a `fresh` set wider than the request merges
  without error.

## Release

- Bump via `scripts/version.sh minor` (UX improvement + a real drift-bug fix).
- Native-host redeploy: rebuild the bundle and kickstart the launchd agent
  (per the standing deploy runbook).

## Out of scope / follow-ups

- Porting `score_structural` to TypeScript for zero-round-trip structural
  scoring (rejected: duplication cost).
- Optimistic/estimated semantic scores (rejected: shows wrong numbers).
- Re-merging FAQ coverage advisories on rescore (deferred; would need coverage
  passed through or recomputed without the full semantic pass).
- Concurrency hardening beyond the functional-`setInFlight` guard (overlapping
  flushes are per-key idempotent through the merge; a stricter in-flight lock is
  not needed for correctness).
