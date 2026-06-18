# Interactive Lint / Proofreader — Design Spec

**Date:** 2026-06-18
**Status:** Approved-by-delegation (user authorized building all of Lint + Interview + Background-sources in one batch), pending implementation plan.
**Scope:** Make the Proofreader (lint) a core, *interactive* post-composition step in the BlogForge draft editor. Frontend-heavy; one backend enhancement (section-anchored findings). Reuses the existing inline-edit endpoint for AI corrections.

## Goal

Today's Proofreader panel lists violations / repetition / positive-hits / fact-check read-only. Make it actionable:

1. **More prominent** — once a draft is composed (stage `sections` with ready content), surface a "Review · N issues" affordance so proofreading is an obvious step, not a buried tool.
2. **Click → jump** — clicking a finding scrolls to the section it's in, opens it, and highlights the flagged text.
3. **Per-finding actions** — **Accept an AI correction**, **edit it manually**, or **leave it** (dismiss).

## Decisions (locked, per user delegation)

- **Shape:** enhance the existing right-side `LintPanel` (slide-in) into an interactive review surface, paired with the existing per-section editor underneath. No separate full-screen mode. Add a prominent entry point on the composed draft.
- **AI fix:** reuse `POST /api/drafts/{id}/inline` (`action: "fix"`, with a lint-aware `instruction`). Show the suggested rewrite; **Accept** replaces the span in the section's `content_md`, saves, and re-lints.
- **Anchoring:** the lint endpoint returns findings anchored to a section (`section_id` + section-local `start`/`end` + exact `match` text). Achieved by linting **per section** (not over the assembled doc) for violations/positive-hits; repetition findings anchor to their named section by locating the phrase substring.
- **Dismiss ("leave it"):** persisted in `localStorage`, keyed by `draftId` + a stable finding key. No DB migration.
- **Coverage:** violations + repetitions get Jump/AI-fix/Edit/Dismiss. Positive hits remain informational (no actions). Fact-check (claims) unchanged.

## Architecture

### Backend — section-anchored lint (`packages/api/blogforge/api/lint.py`)
Change the response so every finding carries its anchor. New per-finding shape (superset of today's):
```
{
  "id": str,              # stable key: f"{kind}:{section_id}:{start}:{rule_id-or-rule}"
  "kind": "violation" | "repetition" | "hit",
  "section_id": str | null,   # null only if it can't be located (shouldn't happen for violations)
  "start": int | null,        # section-local UTF-16 offset (violations/hits)
  "end": int | null,
  "match": str,               # exact flagged text (for highlight + inline-fix input)
  "rule": str,                # rule id / rule name
  "message": str,
}
```
Implementation:
- **Violations + positive hits:** iterate `draft.sections`; for each, run `lint_to_hits(manifest, section.content_md)` / `detect_positive_hits(section.content_md)`. The returned `LintHit.start/end` are already section-local UTF-16 offsets; set `section_id` to that section's id and `match` to `content_md[start:end]` (decoded back from the UTF-16 offsets — see note). Keeps the existing myvoice call; only the iteration scope changes (per-section instead of assembled).
- **Repetitions:** `analyze_repetition(draft)` is inherently cross-section and already names the sections in its `message` and carries the `text` phrase. For each repetition finding, resolve `section_id` by finding the first `draft.sections[*]` whose `content_md` contains the finding's `text` (case-insensitive, after stripping the trailing "…"); set `start/end` to that first occurrence's offsets when found, else leave null (still listed; Jump falls back to scrolling to the section, no highlight).
- The response stays `{ "violations": [...], "hits": [...], "repetitions": [...] }` but each item now has the anchored shape above. (Keeping the three buckets avoids reworking the panel's grouping.)
- **UTF-16 note:** myvoice offsets are UTF-16 code-unit offsets (JS `String.length` semantics). For ASCII/BMP prose they equal Python char offsets. To slice `match` correctly on the backend for non-BMP text, convert via the same `_utf16_offset` inverse, or simpler: have myvoice's `LintHit` already include the matched substring if available — **use `LintHit.match`/`v.match` if present** (myvoice `Violation` has `match: str`); only fall back to slicing when absent. The frontend uses the UTF-16 `start/end` directly against the JS string (native), so the frontend highlight is exact regardless.

No new endpoint, no migration.

### Frontend — interactive Proofreader
Files: `packages/web/src/components/draft/LintPanel.tsx` (rework), new `packages/web/src/lib/lintDismissals.ts`, types in `packages/web/src/api/drafts.ts`, and a small entry-point addition in the sections view (`SectionsPanel.tsx` / workspace).

- **Typed findings:** replace the `unknown[]` lint result with a typed `LintFinding` (the anchored shape) in `api/drafts.ts`; `lintDraft` returns `{ violations: LintFinding[]; hits: LintFinding[]; repetitions: LintFinding[] }`.
- **Finding card** — for each violation/repetition: the `[rule]` tag, the `message`, the `match` snippet, and an action row:
  - **Jump** — scroll to `#section-${section_id}`, ensure the section is open, and highlight: if the section editor is in raw mode, select the `[start,end)` range in the textarea (`setSelectionRange` + focus); otherwise apply a transient highlight wrapper. (Minimum viable: scroll + open + flash the section; range-select is the enhancement.)
  - **AI fix** — call `inlineEdit(draftId, { text: match, action: "fix", instruction })` where `instruction` is finding-aware ("Rewrite to remove the banished phrasing while preserving meaning." / "Rewrite to eliminate the repeated phrasing."). Show the returned text as a preview with **Accept** / **Cancel**. Accept: replace the `match` (or `[start,end)` span) in that section's `content_md`, `saveSection(...)`, then re-lint.
  - **Edit** — Jump (above) and leave the cursor in the editor for manual editing.
  - **Dismiss** — add the finding key to `localStorage`; it's filtered out of the list. A small "Dismissed (N) · show" affordance restores them.
- **Dismissals helper** (`lib/lintDismissals.ts`): `loadDismissed(draftId): Set<string>`, `dismiss(draftId, id)`, `restore(draftId, id)`; key `bf.lint.dismissed.<draftId>`. Findings whose `id` is dismissed are hidden. Pure + unit-tested.
- **Prominence:** after compose (draft stage `sections` with ≥1 ready section), show a "Review · N issues" button in the sections view header that opens the panel; the button's count = non-dismissed violations + repetitions. (Lint runs when the panel opens, as today; the count can lint lazily on first open and cache.)
- **Re-lint after a fix:** Accepting an AI fix or editing re-runs `lintDraft` and refreshes the panel; dismissed keys persist across re-lint.

### Data flow (AI fix)
1. User clicks **AI fix** on a finding (has `section_id`, `match`).
2. `inlineEdit(draftId, {text: match, action: "fix", instruction})` → `{ text }`.
3. Preview shown; on **Accept**: load that section's current `content_md`, replace the first occurrence of `match` (or the `[start,end)` span) with the returned text, `saveSection(draftId, section_id, newContent)`.
4. Re-lint; the fixed finding no longer appears.

## Components & boundaries
| Unit | Responsibility | Depends on |
|---|---|---|
| `lint.py` (backend) | Return section-anchored findings | myvoice lint, repetition, draft store |
| `lintDismissals.ts` | Persist/restore dismissed finding ids | localStorage |
| `LintPanel.tsx` | Interactive review: list, jump, AI-fix preview/accept, dismiss, re-lint | `api/drafts` (lint, inline, saveSection), `lintDismissals` |
| sections view entry | Surface "Review · N issues" | `lintDraft` count |

## Error handling
- Lint failure → existing error banner (unchanged).
- AI-fix (`inlineEdit`) failure → inline error on that finding's card; the draft is untouched; user can retry, edit manually, or dismiss.
- A finding whose `match` is no longer present in the section (text changed underneath) → AI-fix/accept is disabled with a "text changed — re-lint" hint; Jump still scrolls to the section.

## Testing
- **Backend:** unit test the anchored-lint shaping — a draft with a banished word in section B returns a violation with `section_id == B`, correct `start/end`, and `match` equal to the flagged word; a cross-section repeated phrase resolves to a `section_id`.
- **Frontend:** `lintDismissals` unit tests (dismiss/restore/load round-trip). A `LintPanel` component test: renders findings, clicking **Dismiss** removes a finding and persists; clicking **AI fix** calls `inlineEdit` and shows the preview; **Accept** calls `saveSection` with the replaced text.
- Existing suites stay green.

## Out of scope
- Fact-check (claims) changes — unchanged.
- A separate full-screen review mode.
- Server-side dismissal sync across devices (localStorage is sufficient for local-first single-user).
- Bulk "fix all".

## Success criteria
1. After composing, a "Review · N issues" entry is visible; opening it shows actionable findings.
2. Clicking a finding scrolls to and highlights the flagged text in its section.
3. Each violation/repetition supports Accept-AI-fix (preview→accept→applied+re-lint), manual edit, and dismiss-that-persists.
4. Backend lint returns section-anchored findings; existing + new tests pass; no migration.
