# Writing Studio (SP-B) — Design Spec

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan
**Scope:** Reimagined front-door writing experience for BlogForge (`packages/web`). Reuses the existing generation engine; **no backend changes**.

## Goal

Replace today's cramped "New draft" dialog with a full-screen **Writing Studio** at `/compose` that offers four ways to start a blog, all converging on the existing draft editor (`DraftWorkspace`):

1. **Outline-in** — paste your own outline; AI writes the full draft single-pass, honoring your structure.
2. **Propose** — describe the topic; AI proposes an outline you tweak, then writes (reuses the existing ideation flow).
3. **Express** — topic-only; AI outlines *and* writes in one shot, no intermediate review.
4. **Blank** — start an empty draft and write yourself, with inline AI tools.

The studio defaults to the user's **Your Voice** profile (shown as a "writing as ‹voice›" indicator) and tucks per-draft settings behind an **Advanced** disclosure, so Express and Outline-in are effectively topic-only.

## Decisions (from brainstorming)

- **Scope:** reimagine the front door, reuse the engine. Frontend-heavy, low backend risk. (Chosen over augment-alongside and greenfield rebuild.)
- **Modes:** all four above.
- **Voice:** reuse the existing Your Voice profile + an inline indicator; no new profile system, no onboarding wizard. (A skippable empty-profile nudge is a possible later enhancement, out of scope here.)
- **Placement:** a dedicated full-screen route `/compose` replaces `NewDraftDialog`; the dashboard "+ New blog" CTA points to it.
- **Approach:** frontend studio orchestrating existing endpoints (chosen over a backend `POST /api/compose` intent endpoint and over mode-tabs-in-the-dialog).

## Architecture

### Engine facts this relies on (verified)
- Single-pass compose builds its prompt from `draft.outline.sections` / `draft.outline.opening_hook` / `draft.title` / `draft.idea.target_words` (`generate/document.py:_render_document_prompt`). So a draft whose `outline` is set will compose from that outline.
- The expand endpoint backfills `Section` shells from `draft.outline.sections` when `draft.sections` is empty, then composes and sets `stage="sections"` (`api/expand.py:55-65`, `:212`). So callers don't need to pre-materialize sections.
- `expand` requires `draft.outline` to be non-null (409 otherwise) (`api/expand.py:45`).
- `updateDraft` (PUT) persists a set `outline` and never regresses stage (`api/drafts.py:188-193`).
- The ideation flow already produces a `proposed_outline` and an accept path that seeds sections (`api/ideation.py`).

Consequence: **every mode is achievable through existing endpoints; no backend work.**

### Route & components (new, under `packages/web/src/`)
- `routes/ComposePage.tsx` — mounts the studio at `/compose` (added to `App.tsx`, wrapped in `RequireAuth` inside `AppShell`).
- `components/compose/ComposeStudio.tsx` — page shell: `VoiceIndicator`, `ModePicker`, the active-mode panel, and the Advanced settings disclosure.
- `components/compose/ModePicker.tsx` — four accent-coded cards (blue=outline-in, teal=propose, amber=express, green=blank).
- `components/compose/OutlineInPanel.tsx` — outline textarea + live parsed-section preview + "Write draft" CTA.
- `components/compose/ProposePanel.tsx` — topic input + "Start" CTA (routes into ideation).
- `components/compose/ExpressPanel.tsx` — topic input + "Outline & write" CTA.
- `components/compose/BlankPanel.tsx` — optional title + "Open editor" CTA.
- `components/compose/VoiceIndicator.tsx` — "writing as ‹profile name›" + link to `/voice`.
- `components/SetupFields.tsx` — **extracted** shared field group (voice-source toggle, pack, format, provider, model, target length), reused by the studio's Advanced panel and by the in-editor `SetupDisclosure`.
- `lib/parseOutline.ts` — pure markdown/bullet → outline parser.
- `lib/composeDefaults.ts` — read/write last-used settings in `localStorage`.

### Per-mode data flow (all existing endpoints in `api/drafts.ts`)
1. **Outline-in**
   - `parseOutline(text)` → `{ title, sections }`.
   - `createDraft(idea)` (idea.topic = parsed title; settings from `SetupFields`).
   - `updateDraft(id, { ...draft, title, outline: { opening_hook: "", sections, estimated_words: 0 } })`.
   - `expandSections(id)` → `{ job_id }`; `navigate('/drafts/' + id)` (editor streams compose via its existing active-job watcher).
2. **Express**
   - `createDraft(idea)` → `generateOutline(id)` (await) → `expandSections(id)` → `navigate('/drafts/' + id)`.
   - Studio shows an "Outlining → Writing" progress state across the two awaited calls before navigating.
3. **Propose**
   - `createDraft(idea)` (topic only) → `navigate('/drafts/' + id)`; the editor opens at its existing **research/ideation** stage where the user chats, gets a proposed outline, tweaks, and accepts (existing flow seeds sections + composes). No studio-hosted chat.
4. **Blank**
   - `createDraft(idea)` (optional title; empty bullets) → `navigate('/drafts/' + id)`; user writes in the editor with inline AI tools.

### Outline parser — `lib/parseOutline.ts`
`parseOutline(text: string): { title: string; sections: { title: string; brief: string }[] }`
- **Title:** first `#` H1 if present, else the first non-empty line.
- **Sections:** each `##`/`###` heading, and each top-level list item (`-`, `*`, or `N.`), becomes a section title, in document order.
- **Brief:** non-heading, non-bullet text (or indented sub-bullets) following a section title, until the next section title, is collected as that section's `brief` (trimmed, joined).
- **Fallback:** if no headings or bullets are found, treat each non-empty line as a section title; if there is only one line, it is the title and there are zero sections (the studio then disables "Write draft" and points the user at Express — see Error handling).
- Pure and synchronous; no network. Drives the live preview in `OutlineInPanel` and the injected `outline`.

### Settings & defaults — `lib/composeDefaults.ts`
- `loadDefaults()` returns last-used `{ provider, model, format, target_words, use_voice_profile, pack_slug }` from `localStorage` (key `bf.compose.defaults`), or a fallback: `use_voice_profile: true`, first available provider + its first model, `target_words: 1500`, `format: null`, `pack_slug: ""`.
- `saveDefaults(idea)` is called on every successful draft creation.
- `SetupFields` is the single source of truth for the field UI; it fetches providers/models/packs exactly as `SetupDisclosure` does today.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `ComposeStudio` | Orchestrates mode selection → endpoint calls → navigation | `api/drafts`, `parseOutline`, `composeDefaults`, `SetupFields` |
| `parseOutline` | Pure text → outline structure | nothing |
| `composeDefaults` | Persist/restore last-used settings | `localStorage` |
| `SetupFields` | Field UI for idea settings | `api/packs`, `api/providers` |
| `VoiceIndicator` | Show active voice + link | `api/voice` (fetch the profile name) |

Each is independently testable; the studio panels are thin and delegate orchestration to a small `useCompose` hook (in `ComposeStudio`) so the per-mode flows are unit-testable with a mocked api client.

## Error handling
- Any failed endpoint call in a mode flow surfaces an inline error banner (the new `.nb-note`-style coral surface) in the studio and leaves the user on `/compose` to retry; a partially-created draft is left in place (recoverable from the dashboard), matching today's behavior.
- `expandSections` 409 ("Outline must exist") cannot occur in Outline-in/Express because the outline is set/generated first; if it ever does, the error banner shows the message.
- Outline-in with an unparseable paste (zero sections): disable "Write draft" and show a hint to add at least one heading/bullet, or offer the Express path.

## Testing
- **Unit:** `parseOutline` — headings-only, bullets-only, numbered, mixed, brief-collection, prose-fallback, empty/whitespace.
- **Unit:** `composeDefaults` — load fallback, round-trip save/load.
- **Component:** one test per mode that mocks `api/drafts` and asserts the correct call sequence + `navigate('/drafts/:id')` (Outline-in: create→update→expand; Express: create→outline→expand; Propose/Blank: create→navigate).
- **Migration:** existing `NewDraftDialog` tests move to `SetupFields` / `ComposeStudio`; the existing 76-test suite stays green otherwise.
- No backend tests (no backend change).

## Out of scope
- Backend changes of any kind.
- Editor/`DraftWorkspace` redesign (only the entry path changes).
- A studio-hosted chat for Propose (it reuses the editor's ideation stage).
- Empty-voice-profile onboarding/nudge.
- Publishing and editorial calendar (separate, deferred).

## Success criteria
1. `/compose` presents four working modes; the dashboard "+ New blog" opens it; `NewDraftDialog` is removed.
2. Outline-in honors the pasted structure (sections match the parse) and produces a coherent single-pass draft.
3. Express goes topic → finished draft with no intermediate step.
4. Propose and Blank land in the editor at the right stage.
5. Settings persist as last-used; the voice indicator reflects the active profile.
6. `tsc` clean; new unit/component tests pass; the existing suite stays green; no backend diff.
