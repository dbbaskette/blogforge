# Research stage + references — design

**Date:** 2026-05-27
**Status:** Approved (shape) · implementation plan to follow
**Companion to:** existing 3-stage Notebook workspace (PR #12)

## Motivation

The current Stage 1 ("Idea") is a static form: topic, bullets, notes, then click *Generate outline* and the LLM produces a hook + section list in one shot. There's no way to ground the LLM in source material the writer cares about, and no back-and-forth refinement before committing to an outline.

This design replaces Stage 1 with a **Research** stage modeled on `video-production-assistant`'s ideation flow. The user adds reference material (URLs, pasted text, uploaded files) and converses with the LLM until a proposed outline feels right. Accepting locks the outline in and advances to the existing outline-edit stage. References stay attached to the draft and inform every subsequent LLM call (outline regeneration, section composition, section regeneration).

## Workflow

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  1. RESEARCH    │     │  2. OUTLINE  │     │  3. SECTIONS     │
│  (new)          │ ──> │  (existing)  │ ──> │  (existing)      │
│                 │     │              │     │                  │
│ • References    │     │ Edit hook +  │     │ Compose / edit / │
│ • Chat-driven   │     │ section list │     │ regenerate prose │
│   ideation      │     │              │     │                  │
│ • Live outline  │     │              │     │                  │
│   preview       │     │              │     │                  │
│ • "Accept" ───┐ │     │              │     │                  │
└───────────────┼─┘     └──────────────┘     └──────────────────┘
                │            ▲
                └────────────┘  draft.outline ← proposed_outline
```

References are visible in stages 2 and 3 as a collapsible right-rail card; they can be added at any point in the workflow.

## Data model

### New: `Reference`

```python
ReferenceKind = Literal["url", "file", "text"]

class Reference(BaseModel):
    id: str                    # "ref-<base36>-<6hex>"
    kind: ReferenceKind
    name: str                  # display name (URL, filename, or first ~60 chars)
    url: str | None = None     # "url" kind only
    original_filename: str | None = None  # "file" kind only
    extracted_chars: int       # length of extracted markdown, for budgeting
    added_at: datetime
```

Storage path for the manifest + contents: see Storage Layout below. The `Reference` shape on `Draft` is metadata only — extracted content is loaded from disk on demand by the prompt-injector.

### New: `IdeationMessage` / `IdeationSession`

```python
class IdeationMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str               # markdown body of the message
    proposed_outline: OutlineProposal | None = None  # parsed JSON, assistant messages only
    timestamp: datetime

class IdeationSession(BaseModel):
    messages: list[IdeationMessage] = []
```

The session lives at `draft.ideation: IdeationSession | None`. When the user accepts, the most recent assistant message's `proposed_outline` is copied into `draft.outline` and the stage advances.

### Updated: `Draft`

```python
class Draft(BaseModel):
    # existing fields…
    references: list[Reference] = []
    ideation: IdeationSession | None = None
    # stage: rename "idea" -> "research"
    stage: Literal["research", "outline", "sections"] = "research"
```

### Migration

- `DraftStore.get()` reads JSON; if `stage == "idea"`, remaps to `"research"` in-memory before validating. One-line shim. No on-disk rewrite — saves happen naturally on next user edit.
- Existing drafts without `references` / `ideation` default to `[]` / `None` (pydantic defaults).

## Storage layout per draft

```
~/.pencraft/drafts/<id>/
  draft.json
  post.md
  references/
    manifest.json                  # { docs: Reference[] } — source of truth
    originals/
      <ref-id>.<ext>               # raw upload, or url-stub.txt with the URL
    extracted/
      <ref-id>.md                  # cleaned markdown the LLM sees
```

Mirrors VPA's `source-docs/` layout for consistency. Trash on draft delete moves the whole directory (already true; no change needed).

## Extraction

| Kind  | Extractor                            | Notes                                            |
|-------|--------------------------------------|--------------------------------------------------|
| URL   | `trafilatura`                        | Already a transitive dep via myvoice. Falls back to plain HTML strip if extraction is empty. |
| `.md` | identity                             | Read as UTF-8.                                   |
| `.txt`| identity                             | Read as UTF-8.                                   |
| `.pdf`| `pypdf`                              | New dep. Light, pure-Python, no system libs. Concatenates page text with `\n\n` separators. |
| text  | identity                             | User-pasted content; stored as-is.               |

File-size limit: 5 MB (raw) per file. Extracted size limit: 200k chars per ref (truncated with a "[truncated]" marker). Anything larger is rejected at upload time with HTTP 413.

## Endpoints

All under `/api/drafts/{id}/`:

| Method  | Path                          | Body                                  | Result |
|---------|-------------------------------|---------------------------------------|--------|
| GET     | `references`                  | —                                     | `Reference[]` |
| POST    | `references/url`              | `{ url: str, name?: str }`            | `Reference` (fetches + extracts inline; 8s timeout; `name` defaults to extracted page title, else the URL) |
| POST    | `references/text`             | `{ name: str, content: str }`         | `Reference` |
| POST    | `references/file`             | `multipart/form-data` (`file`, `name?`)| `Reference` |
| DELETE  | `references/{ref_id}`         | —                                     | 204 |
| POST    | `ideation/message`            | `{ content: str }`                    | SSE stream → final assistant message persisted. Returns `{ job_id }`. |
| POST    | `ideation/accept`             | —                                     | Updated `Draft` (stage → outline, outline populated) |

The ideation stream reuses the existing `JobRegistry` + SSE pattern from section expansion. On the wire each chunk is the same delta/done/error frames the section endpoint emits, plus one final `result` frame containing the parsed `proposed_outline`.

## Prompt construction

### Reference injection (shared helper)

New file `pencraft/generate/references.py`:

```python
REFERENCE_BUDGET_CHARS = 30_000

def get_reference_context(draft: Draft, draft_root: Path) -> str:
    """Return a '## Reference Materials\n\n…' block, '' when no refs."""
    refs = draft.references
    if not refs:
        return ""
    bodies = [(r, (draft_root / "references" / "extracted" / f"{r.id}.md").read_text()) for r in refs]
    total = sum(r.extracted_chars for r in refs) + len(refs) * 80   # header overhead
    if total <= REFERENCE_BUDGET_CHARS:
        return _concat(bodies)
    return _concat(bodies, per_doc_budget=max(500, (REFERENCE_BUDGET_CHARS - len(refs)*80) // len(refs)))
```

The block is prepended to the user prompt with a `---` separator (same pattern VPA uses).

### Prompt sites

1. `generate/outline.py` — outline regeneration (called from existing button in `OutlinePanel`). Reference block is *prepended* to the user prompt.
2. `generate/section.py` — section composition + regeneration. Same prepend.
3. `generate/ideation.py` (new) — chat-style multi-turn. System prompt = the existing pack-composed prompt + a new ideation system block. User prompt = full conversation history + reference block + the new user message.

### New: ideation system prompt

```
You are helping the author plan a long-form piece in their voice (defined
above by ROLE / Humanizer / style guide). You will go back and forth with
them until they are happy with the outline.

Each of your replies has two parts:

1. A short conversational message — questions you have for them, or your
   reasoning for the proposed outline.

2. A JSON block matching the OutlineProposal schema, fenced with ```json,
   containing:
     - opening_hook: one sentence that opens the piece
     - sections: 5-9 entries; each with `id` (slug), `title`, `brief`
     - estimated_words: integer

The author may reference materials they've shared (under "## Reference
Materials" above). Draw on them for facts, examples, and angle. Stay in
the author's voice — banished words / phrases never appear.

When the author accepts, this JSON becomes their outline. Edit it freely
in response to feedback ("shorter", "add a section on X", "make 3 punchier",
"start with a different hook").
```

The assistant's reply is streamed back to the UI; on `done` the server parses the JSON block, populates `proposed_outline` on the persisted `IdeationMessage`, and ends the SSE stream.

## UI components

### New
- **`ResearchPanel.tsx`** (replaces `IdeaPanel.tsx`). Two-column layout on desktop:
  - **Left**: chat. Message bubbles for user (cobalt) and assistant (white card). Composer at bottom with submit-on-Enter. "Accept this outline →" button enabled when the latest assistant message has a `proposed_outline`.
  - **Right**: live outline preview card (mirrors what's in the latest assistant message), and below it the **`ReferencesList`** card.
- **`ReferencesList.tsx`**. Compact card with:
  - Add-buttons (URL / Text / File) → opens an inline mini-form.
  - List of attached references with name + kind icon + extracted-chars meter + remove (×).
  - Used in `ResearchPanel` (right rail) and as a *collapsible* right-rail card in `OutlinePanel` and `SectionsPanel` (always-available, never required).
- **`AddReferenceForm.tsx`** (small helper). Three modes (URL / text / file); each shows the relevant fields. On submit, calls the corresponding endpoint and adds the new ref to the list.

### Updated
- **`DraftWorkspace.tsx`**: stage-aware switch updates `idea` → `research` and renders `ResearchPanel` instead of `IdeaPanel`. `OutlinePanel` and `SectionsPanel` accept an optional `references` prop and render `ReferencesList` in their right rail.
- **`DraftsPage.tsx`**: stage label map updates `idea` → "Researching" (pill stays empty-state coloured).
- **`OutlineSidebar.tsx`** / **`StatusPill`**: any UI that hard-codes the stage label `"idea"` updates to `"research"`.

### Removed
- `IdeaPanel.tsx` — the static form. (Bullets + notes are still in the data model; they're now appended to the *first* user message in the ideation chat as seed material.)

## Job streaming

Reuse `pencraft.jobs.registry.JobRegistry`. Ideation gets its own job kind `"ideation"`. The existing `useExpandJob` keeps its current shape (section-specific). A new `useStreamJob({ onDelta, onResult, onError })` hook is added for ideation; both endpoints emit the same frame shapes:
- `event: stage` — `section:start:<id>` / `ideation:start`
- `event: chunk` — `{ delta: string }`
- `event: result` — final assembled payload (for ideation: `{ message_id, proposed_outline }`)
- `event: done` / `event: error`

**Concurrency:** at most one in-flight ideation job per draft. The UI disables the Send button while streaming; the server rejects a second `POST /ideation/message` with `409 ideation_in_progress` until the prior stream completes or is cancelled.

## Error handling

| Failure                                                       | Surface                                                      |
|---------------------------------------------------------------|--------------------------------------------------------------|
| URL fetch fails (timeout / 4xx / 5xx)                         | 422 with code `url_fetch_failed`, message includes status    |
| URL extraction yields empty content                           | Save ref with `extracted_chars: 0` + warning toast (still useful as a citation, but the LLM gets nothing) |
| File too large (>5MB raw / >200k chars extracted)             | 413 with code `file_too_large`                               |
| Unsupported file ext                                          | 415 with code `unsupported_file_type` (list supported)        |
| Ideation LLM reply missing the JSON block                     | The assistant message is saved; `proposed_outline` is `null`; Accept stays disabled. User can ask "give me the JSON" or just chat more. |
| Ideation LLM reply has malformed JSON                         | Same — log the parse error in `last_error` on the message; surface in chat. |
| Reference fetch fails *during composition* (deleted file)     | The ref is skipped, prompt still goes through, server logs warning. |

## Testing

### API (pytest)
- `test_references_url.py`: mock `trafilatura.fetch_url`; assert add → list → delete cycle; assert prompt-injector picks up the extracted content.
- `test_references_file.py`: upload a `.md`, a `.txt`, a small `.pdf` (use a 1-page fixture); assert extracted markdown matches expectations.
- `test_references_text.py`: pasted text round-trips.
- `test_references_budget.py`: simulate 5 refs at 10k chars each; assert truncation under the 30k budget keeps every ref's first ~5800 chars.
- `test_ideation_round_trip.py`: mock LLM to emit a fixed reply + JSON; assert message persisted, `proposed_outline` parsed, `/accept` populates `draft.outline` and flips stage.
- `test_stage_migration.py`: load a draft with `stage: "idea"`; assert `get()` returns `"research"`.

### Web (vitest)
- `ResearchPanel.test.tsx`: renders chat + outline preview; Accept disabled until a `proposed_outline` arrives.
- `ReferencesList.test.tsx`: add / remove flows hit the right endpoints; rendered chip counts match.
- `DraftWorkspace.test.tsx`: at `stage: "research"` the ResearchPanel mounts; at `outline` / `sections` the ReferencesList is visible as a collapsible card.

### e2e (deferred)
- Playwright spec covering the full research → outline → sections flow with a mocked LLM (out of scope for this PR; landed as a follow-up).

## Out of scope (v1)

- Per-section reference *pinning* (attaching refs to specific sections only). Refs apply globally.
- Web search inside ideation ("look up X for me"). Refs must be supplied by the user.
- Reference re-fetch / freshness tracking. URLs are fetched once at add-time; we don't poll for updates.
- Image / screenshot references. Vision-capable models only — defer until we have a vision-aware provider abstraction.
- Reference citations in the prose output. The LLM is told to use refs for grounding, not to cite. A "citation mode" toggle can come later.
- Editing extracted markdown by hand. If the extraction is wrong, you remove and re-add.

## Open questions

None outstanding from the brainstorm. The shape, scope, and endpoint list are approved by the author.

## Risks

- **`pypdf` dependency creep.** Mitigation: pin to a single recent version; add an import-time guard that surfaces a clear "PDFs not supported in this install" error if it isn't available, so the rest of the feature still ships.
- **Ideation JSON drift.** If the LLM emits non-conforming JSON often, the user can't accept. Mitigation: parse leniently (allow extra keys, coerce stringly-typed integers), and on parse failure show the assistant text but keep Accept disabled with a clear "the model didn't include a structured outline — ask it to" hint.
- **Big extractions blowing the prompt.** 30k chars × multi-section draft of 9 calls = ~270k tokens *just* for refs across the lifetime of a draft. Mitigation: the 30k budget is conservative; we proportionally truncate; we can add a per-call summarisation pass later (VPA has this as opt-in).
- **Stage rename breaks tests / Playwright e2e.** Mitigation: grep for `"idea"` / `'idea'` literal usage across both packages before merging; covered by `test_stage_migration.py`.
