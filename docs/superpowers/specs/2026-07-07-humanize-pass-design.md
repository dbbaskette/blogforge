# Humanize Pass — Design Spec

**Date:** 2026-07-07
**Status:** Design — pending user review, then implementation plan.
**Scope:** Add an on-demand **Humanize** pass to the draft editor that makes prose *read as written by a person*, complementing the existing anti-AI-tells system. New `Improve ▾ → 🫶 Humanize` tool (GEO-style review rail), a Light/Medium/Strong intensity dial, and unification of the existing "Reads X% human" score so both detectors feed one number. Generation-time prompts are **unchanged**.

## Background — what already exists

BlogForge's writing prompt is composed in `voice/compose.py` as **ROLE → Humanizer → Writing Craft → Style Guide → format/exemplars**:

- **"Section 1: The Humanizer (Strict Anti-Robot Constraints)"** (`_render_humanizer`) injects banished words/phrases, no-em-dash rules, and `assets/ai-tells/patterns.md` (burstiness, no rhetorical-question bridges, no anaphora, no puffery…).
- Post-generation, `voice/enforce.py` detects/repairs/backstops mechanical violations.
- A **myvoice lint** pass (`api/lint.py`) returns section-anchored findings (violations / repetitions / hits), which drive the interactive Proofreader (`LintPanel.tsx`) and the **Humanity Score** (`humanityScore()` in `checkup.ts` / `LintPanel.tsx`) surfaced as "Reads X% human" in `CheckupPanel.tsx`.

**Everything above is subtractive** — *"scrub the LLM-isms; don't sound like a robot."* This spec adds the missing **additive** half — *"do sound like a person"* — as an on-demand pass, and unifies both under one score.

Source: the 7 techniques in the @AiWithRubab thread (Thought Flow, Pattern Breaker, Credibility, Voice Shaper, Imperfections, Audio Test, Soul Detector).

## Decisions (locked with user)

1. **On-demand only.** A new Improve tool + Checkup dimension. **No change to generation prompts** (`compose.py`, `section.j2`, …). It never fires unless the writer runs it.
2. **Intensity dial** `Light | Medium | Strong` that **deterministically gates which lenses run** (not a vague aggressiveness knob).
3. **7 tips → 4 curated lenses** (below), each a GEO-style finding group with per-sentence fixes.
4. **Guardrail:** Humanize rewrites **tone / rhythm / phrasing only**. It must never add, remove, or alter facts, numbers, names, quotes, or citations, and must not rewrite the answer-first opening sentence that GEO scores. Enforced by (a) prompt constraint and (b) a deterministic diff-check.
5. **One unified "Reads X% human" score**, fed by **both** detectors (anti-tells lint + Humanize lenses) via a **blend of two sub-scores**, with Humanize findings **persisted** to avoid jitter. **Proofread and Humanize remain two separate fix-tools** (they fix genuinely different things at different cost/speed).

## The 4 lenses (7 tips → 4)

| Lens | Tips folded in | Detects | Rewrites toward |
|---|---|---|---|
| **Flow & Rhythm** | #1 Thought Flow, #6 Audio Test | Metronomic / over-even cadence; passages that read like a document, not speech | Irregular cadence — some lines blunt, some longer; natural pauses; reads aloud like a person thinking |
| **Voice & POV** | #4 Voice Shaper | Neutral-observer hedging; opinion-free "balanced" prose | A clear stance, an opinion, a small contradiction, natural tonal shifts |
| **Imperfections** | #5 Imperfections Injector | Too-clean, no-history prose | Lived-in touches — a strong aside, a hesitation, an intentional incomplete sentence *where it fits* |
| **De-robot / Soul** | #2 Pattern Breaker, #3 Credibility, #7 Soul Detector | The most artificial / over-polished / over-precise sentences | Rewritten "as if said to a close friend" — at the *sentence* level (vs. the lint's banned-token level) |

### Dial → lens engagement
- **Light** → Flow & Rhythm + De-robot/Soul *(safe for any register: better cadence, less stiffness, no invented stance)*
- **Medium** *(default)* → + Voice & POV
- **Strong** → + Imperfections *(hesitations, incomplete sentences, contradictions)*

Gating is a static map `INTENSITY_LENSES: dict[str, tuple[Lens, ...]]`, trivially unit-testable.

## Architecture

### Backend — `packages/api/blogforge/generate/humanize.py` (new, mirrors `geo.py`)

- `run_humanize(draft: Draft, *, intensity: Intensity) -> HumanizeReport`
  - Selects lenses via `INTENSITY_LENSES[intensity]`.
  - One LLM call (JSON out) using the lens rubrics + dial, returning per-lens findings. (A cheap deterministic pre-filter — e.g. a metronomic-rhythm detector over sentence lengths — MAY seed Flow candidates before the model call; optional, not required for v1.)
  - Each **finding** follows the **GEO finding model** (not the lint `start/end/match` model): section-relative substring targeting, which the shared `Issue` pipeline already knows how to render and locate.
    ```
    {
      "lens": "flow" | "voice" | "imperfections" | "soul",
      "section_id": str,       # section id; "opening" for the lede (draft.outline.opening_hook)
      "target": str,           # the verbatim original sentence (located in-section by substring)
      "suggestion": str,       # the humanized rewrite (precomputed)
      "note": str,             # one line: why this reads robotic
      "needs_review": bool,    # set by the guardrail diff-check
    }
    ```
    A lens is a group `{ "key": lens, "label", "findings": [...] }`, mirroring a GEO lever. `analyze_humanize` returns `{ "intensity", "score", "lenses": [ ...lens groups... ] }`.
- **Guardrail** `_guard(target, suggestion) -> bool`: extract numbers, URLs/markdown-links, and `"quoted spans"` from both; if the sets differ, set `needs_review=true` (the fix is shown but not auto-applied — the writer must confirm). Prompt also states the constraint explicitly.
- **Rubric asset** `voice/assets/humanize/lenses.md` — the 4 lens rubrics (the curated 7 tips as instructions), loaded via `importlib.resources` like `load_ai_tells()`; per-pack override at `<pack>/humanize/lenses.md` (same override pattern as `ai-patterns.md`).
- **Persistence:** there is **no server-side report storage** in this codebase — GEO/Shape reports are cached **client-side** in `panelCache.ts` (`localStorage`, key `bf.panelcache.${kind}.${draftId}`, keyed by a `hashDraftContent(draft)` content hash). Humanize does the same: add `"humanize"` to `PanelKind`. Because the cache is content-hashed, a re-run on unchanged text returns the cached report — so the score is stable between runs without jitter, and only re-computes when the draft actually changes.

### Backend — API
- `POST /api/drafts/{id}/humanize` `{ intensity }` → runs `run_humanize`, persists, returns the report. (Mirrors the GEO analyze endpoint.)
- **Apply is client-side, no second model call.** The pass already computed `suggestion`, so **Accept** replaces the `[start,end)` span in the section's `content_md` with `suggestion` and calls the existing `saveSection` — no `/inline` round-trip (unlike Proofread, which computes its fix on demand). This makes Humanize Accept instant and deterministic. **Manual fix** opens the section editor at that span for hand-editing.

### Frontend
The review UI is built on a **shared `Issue` pipeline** (`lib/issues/types.ts` → per-panel adapter → `IssueCard` + `useIssueLifecycle`), which both GEO (`geoAdapter` + `GeoReviewRail`) and Proofread (`proofreadAdapter` + `ProofreadReviewRail`) already use. Humanize plugs into the same machinery rather than reinventing a panel.
- **Entry point:** add a `🫶 Humanize` item to the data-driven `improveItems` array in `WorkspaceFooter.tsx` (peer of Proofread / Shape / GEO / Headlines); add `humanizeOpen` state + `onHumanize` handler in `DraftWorkspace.tsx` and mount `{humanizeOpen && <HumanizePanel …/>}`.
- **Adapter:** new `lib/issues/humanizeAdapter.ts` (`humanizeFindingsToIssues(report) → Issue[]`), adding `"humanize"` to `Issue.panel`. Each finding → an `Issue` with `sectionId`, `target`, `nature`, `fixKind`, and actions `ai_fix / manual_fix / highlight / dismiss`.
- **Apply:** `lib/issues/humanizeApply.ts` (`makeHumanizeApply` / `makeHumanizeSave`) — Accept applies the precomputed `suggestion` by replacing `target` in the section's `content_md` and calling `saveSection` (no model call). `needs_review` issues render an amber "verify — changes a number/link" note and require explicit confirm.
- **Panel:** `HumanizeReviewRail.tsx` (thin, modeled on `ProofreadReviewRail.tsx`) renders the 4 lens groups via the shared `IssueCard`/`useIssueLifecycle`; a `HumanizePanel.tsx` slide-in hosts it plus the dial. Reuse `HighlightedText`/`HumanityRing` as-is.
- **Dial:** a `Light | Medium | Strong` segmented control in the panel header; changing it re-runs `POST …/humanize` (and re-caches). Selected intensity persisted in `localStorage` (`bf.humanize.intensity.<draftId>`), default `medium`.
- **Client:** new `api/humanize.ts` with `analyzeHumanize(draftId, intensity)` (mirrors `api/geo.ts::analyzeGeo`), not stuffed into `drafts.ts`.
- **Dismissals:** `lib/humanizeDismissals.ts` mirroring `lib/lintDismissals.ts` (localStorage, `bf.humanize.dismissed.<draftId>`).
- **Cache:** add `"humanize"` to `PanelKind` in `panelCache.ts`; the panel reads/writes the report exactly as `OptimizePanel`/`CheckupPanel` do for `"geo"`.

### Unified score (`checkup.ts` + `LintPanel.tsx`)
Replace the single `humanityScore(openCount, hitCount)` with a blend of two 0–100 sub-scores:

```
antiRobotSub  = existing lint-based score          (deterministic, always available)
humanSignalSub = 100 - capped_dock(open humanize findings, by lens)   (null until Humanize has run)

humanness = humanSignalSub == null
          ? antiRobotSub                                   // partial: show a "run Humanize for full read" hint
          : round(W_ROBOT*antiRobotSub + W_HUMAN*humanSignalSub)   // W_ROBOT=0.5, W_HUMAN=0.5 (tunable)
```

- `capped_dock` uses **per-lens caps** (e.g. each lens can dock at most ~15 pts) rather than a flat `−6 × count`, so a Strong pass surfacing 20 touch-ups can't nuke the number and switching dials doesn't wildly swing it.
- Because Humanize findings are **persisted**, `humanSignalSub` is stable between deliberate re-runs.
- `CheckupPanel.tsx` fan-out becomes `Promise.allSettled([lint, geo, shape, humanize])`; the "Reads X% human" meter uses `humanness`; the breakdown behind it shows the anti-robot vs human-signal split. Proofread and Humanize appear as the two fix-tools that raise it.

## Components & boundaries
| Unit | Responsibility | Depends on |
|---|---|---|
| `generate/humanize.py` | Run lenses (dial-gated), return anchored findings, guardrail | LLM client, Draft store, `assets/humanize/lenses.md` |
| `assets/humanize/lenses.md` | The 4 lens rubrics (curated 7 tips) | — |
| `api` humanize endpoint | Run + persist + return report | `humanize.py`, draft store |
| `humanizeDismissals.ts` | Persist/restore dismissed finding ids | localStorage |
| Humanize panel (reuses `OptimizePanel`/`GeoReviewRail`) | 4 lens groups, dial, AI-fix/accept/undo/highlight/dismiss | `api/drafts` (humanize, saveSection), dismissals |
| `checkup.ts` / `LintPanel.tsx` | Blend the two sub-scores into one `humanness` | lint result + persisted humanize report |

## Data flow (AI fix)
1. Writer runs **Humanize** (intensity from the dial) → `POST …/humanize` → report persisted, rail renders 4 lens groups.
2. On a finding, **AI fix** shows the precomputed `suggestion`; **Accept** replaces `[start,end)` with `suggestion`, `saveSection(...)`, marks resolved (no model call). `needs_review` findings require confirm first.
3. Score refreshes from the persisted report (open-finding count changes); re-running Humanize re-computes and re-persists.

## Error handling
- Humanize LLM failure → error banner in the panel; draft untouched; retry available. (Matches GEO.)
- A finding whose `match` no longer exists (text changed underneath) → Accept disabled with "text changed — re-run Humanize"; Highlight still scrolls to the section.
- Guardrail trip (`needs_review`) → never auto-applied; the writer sees what number/link would change and confirms or edits manually.

## Testing
- **Backend:** `INTENSITY_LENSES` gating (Light excludes Voice/Imperfections; Strong includes all); rubric-asset load + per-pack override; guardrail `_guard` (changed number/URL → `needs_review`, pure tone change → not); a fixture draft → report snapshot with mocked LLM. Under `tests/generate/`.
- **Frontend:** `humanizeDismissals` round-trip; the blended `humanness` (null human-signal → anti-robot only; both present → weighted; per-lens cap holds under many findings); a panel test mirroring `GeoReviewRail` (renders lens groups, AI-fix → accept → saveSection, `needs_review` requires confirm).
- Existing suites (lint, GEO, checkup) stay green — the score change is additive/back-compatible when Humanize has never run.

## Out of scope (YAGNI)
- **No** changes to always-on generation (`compose.py`, section prompts). Easy follow-up if we later want a light additive nudge baked in.
- **No** new voice-pack manifest fields — the dial is a panel control, not pack config. (Per-pack default intensity is a future option.)
- **No** "fix all" bulk apply; **no** cross-device dismissal sync (localStorage is fine for local-first).

## Success criteria
1. `Improve ▾ → 🫶 Humanize` runs a dial-gated pass and shows 4 lens groups of per-sentence findings with Accept-AI-fix / Manual / Highlight / Dismiss.
2. Light/Medium/Strong deterministically change which lenses appear; the choice persists per draft.
3. No finding auto-applies a change to a number, link, or quote (guardrail); such findings are flagged `needs_review`.
4. "Reads X% human" is a single score fed by both the anti-tells lint and the persisted Humanize findings, stable between re-runs; Proofread and Humanize both raise it.
5. New + existing tests pass; no migration.
