# Humanization Check Design

**Date:** 2026-07-28

## Goal

Replace BlogForge's user-facing blended "reads human" percentage with a
transparent Humanization Check that reports the current deterministic
voice-rule findings and current LLM Humanize suggestions separately.

## Problem

The current display averages two unrelated heuristics:

- an anti-robot score derived from deterministic lint and repetition counts;
- a human-signal score derived from the number of findings returned by the
  Humanize LLM pass.

The LLM pass is not a stable measurement. It can discover different findings
after edits, and Medium or Strong intensity examines more lenses than Light.
Consequently, a writer can apply valid fixes, re-analyze, and receive a lower
number. Labeling that value "reads human" also makes an issue-count heuristic
look like a validated authorship probability.

## User Experience

### Humanize panel

Keep the existing Light, Medium, and Strong selector. Replace the waveform,
two score bars, and large percentage with a compact **Humanization Check**.

The check contains two independently reported rows:

1. **Voice-rule check**
   - `No voice-rule issues` when lint and repetition counts are both zero.
   - `<N> open findings` otherwise.
   - `Checking voice rules…` while the lint request is pending.
   - `Voice-rule check unavailable` if the lint request fails.

2. **Humanize review**
   - `No suggestions across <K> lenses` when the completed report is empty.
   - `<N> suggestions across <K> lenses` otherwise.
   - `Analyzing <K> lenses…` while Humanize is pending.
   - `Humanize review unavailable` when the Humanize request fails.

The summary label is derived from current states, not a numeric threshold:

- **Voice rules need attention** when deterministic findings remain.
- **Review Humanize suggestions** when voice rules are clean and Humanize
  returned one or more suggestions.
- **Looks natural** when both completed checks are empty.
- **Checking humanization…** while either required result is pending.
- **Check incomplete** when either result is unavailable.

The existing detailed Humanize findings, preview/apply/accept workflow,
intensity behavior, caching, and stale-result notice remain unchanged.

### Checkup panel

Remove the blended waveform and percentage from the Checkup header. Checkup
continues to show its existing Proofread and Humanness rows, but those rows
report exact finding counts. The header keeps the existing prioritized
publication-readiness headline and `<N> to address` copy.

If the Humanize request fails while other Checkup requests succeed, the
Humanness row says `Humanize review unavailable` rather than treating the
missing result as a partial human score.

### Scope boundaries

- The API may continue returning the legacy Humanize `score` field for
  compatibility, but the web UI will not use it as a user-facing measurement.
- The Proofreader panel's standalone ring is not changed in this increment.
- GEO scoring is unrelated and remains unchanged.

## Architecture

Add a reusable presentation component that receives explicit check states:

- voice-rule open count or `pending` / `unavailable`;
- Humanize finding count, engaged lens count, or `pending` / `unavailable`.

The component derives only labels, counts, and semantic severity. It performs
no percentage calculation and stores no baseline. `HumanizePanel` will retain
the lint result count instead of converting it to an anti-robot score.
`CheckupSummary` will retain the availability and count data needed to render
an incomplete Humanize result honestly.

Delete the obsolete `HumannessPulse` component and its tests after both
consumers migrate.

## Error and stale-state behavior

- A failed Humanize request never displays a score or a clean result.
- A failed lint request never substitutes a placeholder value.
- Cached results preserve the same stale-result notice currently used by the
  panels.
- Re-analysis replaces the displayed counts with the newest completed result;
  it makes no claim that the counts must move monotonically.

## Verification

- Unit-test status derivation for pending, unavailable, clean, deterministic
  findings, and advisory suggestions.
- Update Humanize panel tests to assert explicit counts and the absence of
  "reads human".
- Update Checkup summary and panel tests for unavailable Humanize results and
  the absence of the blended score.
- Run the full relevant web test suite, lint, build, synchronized-version
  check, and deployment-script tests.

## Release and deployment

This is a deployable UI behavior change and releases BlogForge **0.8.3**.
After review, push a feature branch, open and merge a pull request, remove the
merged branch/worktree, return the primary checkout to synchronized `main`,
and run `scripts/deploy-home.sh`. Completion requires internal and public
health responses reporting version `0.8.3`.
