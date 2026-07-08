# Editing, GEO, and Voice improvements — design

**Date:** 2026-07-08
**Status:** Approved (user), pending implementation
**Scope:** Six improvements from live use of v0.2.0: a new AI-tell rule, a
fix-preview diff modal, explicit GEO impact copy, eight new GEO levers,
voice-generation upgrades, and citation findings that use attached sources.

## Context

Findings from a real writing session on the merged v0.2.0 app:

- Drafts still ship staccato paired-list runs ("A and B. C and D. As well as
  E and F.") — an AI-ism no current tell/lint rule covers.
- The apply→amber-highlight→accept flow makes it hard to see what a fix will
  do before it lands, and hard to compare original vs. new after.
- GEO findings say *what* to change but not *what it does for GEO*.
- GEO has 12 levers; several high-value GEO/SEO signals are unscored.
- The voice pipeline distills samples into a prose style guide, but the
  deterministic fingerprint (`voice/fingerprint.py`: sentence-rhythm
  histogram, signature phrases, vocabulary) is display-only — never fed to
  composition. Confirmed: `grep fingerprint voice/compose.py generate/*.py`
  → no hits.
- GEO's citation lever never sees `draft.references` (confirmed:
  `grep references generate/geo.py` → no hits), so it nags "no sources
  cited" even when the writer attached sources.

## Part 1 — New AI-tell: staccato paired-list runs

The pattern: consecutive short sentences that are each a bare pair
("Isolation and security. Cost and control. As well as speed and scale."),
plus sentences starting "As well as". Humans vary list joinery; models
metronome it.

Three layers:

1. **Compose-side prevention** — `voice/assets/ai-tells/patterns.md` gains a
   rule: don't chop a list into uniform "X and Y." sentences; connect the
   ideas or use a real list. Rides into every compose/humanize prompt via the
   existing ai-tells merge.
2. **Deterministic detection** — `voice/lint.py::detect_ai_patterns` gains
   `ai_pattern:staccato_pairs`: flag a run of ≥2 consecutive sentences, each
   ≤12 words, each matching `<phrase> and <phrase>.` (single conjunction, no
   other connective), or any sentence starting "As well as". Shows in
   Proofread, counts against the anti-robot score like other `ai_pattern:*`
   hits. Pure function + unit tests (positive run, negative single pair,
   negative long sentences containing "and").
3. **Humanize rubric** — the Flow & Rhythm lens rubric in
   `generate/humanize.py` names the pattern explicitly so LLM findings catch
   variants the regex can't.

## Part 2 — Fix-preview modal (preview-first, user's pick)

**Flow:** Click **AI fix** → *nothing changes in the draft* → a modal opens
with original (left) and rewrite (right), word-level change highlighting,
the finding's why, and three actions: **Apply**, **Edit rewrite**, **Cancel**.
Apply persists the change and marks the issue **accepted** in one step — the
amber in-draft under-review state is retired for AI fixes (Undo remains on
the accepted card via the existing ledger; statuses persist across reopen).
After Apply, fire a transient locate highlight at the applied text so the
read pane shows where it landed.

**Scope:** `ai_fix` on all three rails (Humanize, GEO, Proofread).
`manual_fix` keeps its inline textarea; other actions unchanged. The modal's
**Edit rewrite** turns the right pane into a textarea — Apply then saves the
edited text (covers "close but not quite" without leaving the modal).

**Mechanics:**

- New shared `components/review/FixPreviewModal.tsx` (BlogForge theme:
  nb-card, serif prose panes, rule borders; `useDialogA11y`).
- New pure `lib/wordDiff.ts`: word-level LCS diff → `{value, kind:
  "same"|"added"|"removed"}[]` segments; left pane renders removed segments
  (coral wash, strikethrough), right pane renders added (green wash).
  Unit-tested (identical, full replace, mid-sentence edit, whitespace
  reflow).
- `useIssueLifecycle` gains a preview phase. Apply factories accept
  `persist: false` (default `true` for back-compat): they compute and return
  `Applied {sectionId, before, after, field}` **without saving**. For
  Humanize the suggestion is precomputed → modal opens instantly. For
  GEO/Proofread the model call runs first (existing busy overlay), then the
  modal opens *before* anything saves. On modal Apply the lifecycle persists
  via its existing `save`, writes the undo ledger, sets status `accepted`
  (persisted). Cancel discards; errors surface via the existing `errorOf`
  path (stale-target message etc.).

## Part 3 — GEO explicitness

Every GEO finding gains a required `impact` field: one concrete sentence of
GEO mechanism, e.g. *"Answer engines quote the first 40–60 words of a
section; burying the answer means they quote someone else's page."* Not
restating the fix — stating the payoff.

- Backend: `generate/geo.py` prompt requires `impact` per finding;
  `parse_semantic` carries it through (defaults to "" for old cached
  reports).
- Frontend: `geoAdapter` maps `impact` onto the Issue; `IssueCard` renders an
  `impact` line distinctly (small, cobalt, prefixed "GEO:") under the why.
  Prop is optional so Humanize/Proofread cards are unaffected.
- Lever headers additionally show stakes: "worth up to N pts" from the
  lever's existing `weight` (already in the report payload).

## Part 4 — Eight new GEO/SEO levers

No overlap with the existing 12 (answer_first, factual_density, citations,
definitional_opener, question_headings, skimmability, brand_explicit, faq,
chunking, takeaways, freshness, comparison_table).

| Key | Label | Checks | Weight |
|---|---|---|---|
| `stat_attribution` | Stats tied to sources | Numbers bound inline to a named source ("per Gartner, 2025") — claim→source binding, distinct from counting numbers (factual_density) or links (citations) | 0.04 |
| `query_coverage` | Covers follow-up questions | Answers the adjacent questions a reader asks next (cost, limits, alternatives) so the piece is one-stop | 0.04 |
| `sound_bites` | Liftable sound bites | ≥2 self-contained one-sentence statements <25 words an engine can quote verbatim | 0.03 |
| `entity_consistency` | Consistent entity names | One canonical name per product/technology; aliases ("TP", "the platform") dilute entity resolution | 0.03 |
| `experience_signals` | First-hand experience | E-E-A-T: "we measured", "when I ran this" — first-person evidence generic AI content lacks | 0.03 |
| `jargon_defined` | Jargon defined on first use | Appositive/parenthetical definitions keep passages self-contained for extraction | 0.03 |
| `concrete_examples` | Worked examples | How-to claims backed by a concrete example or code block | 0.02 |
| `title_shape` | Title shape | H1 carries a how-to/number/year hook and stays ≤60 chars | 0.02 |

Existing weights shave to make room; new total sums to 1.00:
answer_first .13, factual_density .13, citations .09, definitional_opener
.06, question_headings .06, skimmability .06, brand_explicit .04, faq .04,
chunking .04, takeaways .04, freshness .04, comparison_table .03, + the
eight above (.24).

All eight are scored in the same semantic LLM pass (rubric sections added to
the prompt) and emit findings with `impact` lines like every other lever.
`_ORDER` places them by leverage. A unit test asserts weights sum to 1.0.

## Part 5 — Voice: use what the samples already say

Three upgrades, all automatic at profile-pack build time (no new UI):

1. **Fingerprint → compose.** When the profile pack is built, write a
   `fingerprint.md` into the pack root rendered from
   `voice/fingerprint.py`'s deterministic stats: sentence-rhythm mix ("~40%
   of sentences under 10 words; longest ~35"), the author's actual signature
   phrases, and top vocabulary. `voice/compose.py` includes it in the prompt
   (mtime-cached like style-guide.md). Guidance framing: match the rhythm
   distribution, reach for these phrases when natural — never force them.
2. **Distill v2.** `voice/distill.py`'s prompt extracts structured traits the
   current one misses: how the author opens pieces, transition habits,
   opinion strength (hedged vs. declarative), anecdote/aside frequency,
   humor style — each as concrete do's/don'ts an imitator can follow.
3. **Verbatim exemplars.** At pack build, select 2–3 short excerpts
   (~200–300 chars each, from different samples, favoring passages the
   fingerprint marks as signature-dense) into `exemplars.md`; compose
   includes them under "the author's actual writing — match this texture."
   Imitation beats description.

Regenerating a voice (existing re-distill action) picks all three up; no
migration needed for packs that lack the new files (compose treats them as
optional).

## Part 6 — Citations use attached sources first

`generate/geo.py`'s scoring call gains the draft's attached sources:
`draft.references` (title, url, kind) plus the profile's background sources
(`voice/sources_context.py`). The citations rubric becomes:

1. Match the draft's claims against the attached sources **first**. A match
   yields a finding like *"This claim matches your attached 'Tanzu 10.4
   release notes' — cite it here"*, whose `suggestion` contains the exact
   sentence with the markdown link inserted, so **AI fix** is a client-side
   splice (same mechanism as Humanize fixes — through the preview modal).
2. Only claims no attached source covers may prompt outside sourcing — and
   the finding must name the *kind* of source ("a dated benchmark for the
   latency claim"), never a generic "add sources".
3. When sources are attached, the lever's summary acknowledges them ("4
   sources attached; 2 cited in-text") instead of scoring as if none exist.

## Testing

- **Unit:** staccato detector (runs/negatives), `wordDiff` (4 cases),
  lifecycle preview→apply/cancel (no save on cancel; save+accepted on
  apply), geoAdapter impact mapping, weights sum to 1.0, fingerprint.md
  rendering, distill prompt contains new trait sections, geo prompt includes
  attached references.
- **Full gates:** web tsc + vitest, api pytest.
- **Live Chrome:** modal on all three rails (apply, cancel, edit-rewrite),
  impact lines on GEO cards, a citation finding referencing an attached
  source on a draft that has references, staccato lint hit on a seeded
  passage.
- Ship: `scripts/version.sh minor` (0.2.0 → 0.3.0), CHANGELOG entry.

## Out of scope

- "Refine from my edits" voice feedback loop (declined this round).
- Preview modal for `manual_fix`/`generate`/other input actions.
- Deterministic scoring for the new GEO levers (LLM pass only this round).
