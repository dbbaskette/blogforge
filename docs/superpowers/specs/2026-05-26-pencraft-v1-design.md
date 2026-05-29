# BlogForge v1 — Design

**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Date:** 2026-05-26
**Author:** Dan Baskette (with Claude)
**Parent reference:** myvoice's parent design at `/Users/dbbaskette/Projects/myvoice/docs/superpowers/specs/2026-05-22-myvoice-design.md` mentions BlogForge as a future consumer of style packs.

---

## Overview

BlogForge is a local-first web app that drafts long-form blog posts in an author's voice using a [myvoice](https://github.com/dbbaskette/myvoice) style pack. Where myvoice's Compose & test rewrites a paragraph you wrote, BlogForge generates a full draft from a topic + a few bullets, in three stages: **idea → outline → sections**.

Each stage persists to disk. Drafts resume across browser closes. After generation the user has a Tiptap editor per section plus a "Regenerate this section" button, so iteration is per-section, not whole-document.

BlogForge depends on myvoice as a Python library (Phase 7 published the public API). It reuses myvoice for: pack discovery (`PackStore`), prompt assembly (`compose_prompt`), and linting the output (`lint`). It does NOT reach into myvoice internals.

**In scope (v1):**
- 3-stage drafting workflow (idea → outline → sections), one draft at a time
- All 3 LLM providers (Anthropic / OpenAI / Google), structured output for outline, streaming for sections
- Per-section regenerate + per-section markdown edit (Tiptap)
- Reorder sections in Stage 2 (outline); reorder also allowed in Stage 3 but does not invalidate content
- Draft persistence to `~/.blogforge/drafts/<id>/`
- Soft-delete drafts to `~/.blogforge/trash/<ts>-<id>/`
- Lint the assembled draft via `myvoice.lint` against the pack
- Download / copy assembled markdown
- API keys sourced from `~/.myvoice/config.yaml` (read-only; no BlogForge Settings page)
- All 3 providers' availability surfaced through `GET /api/providers` (which keys exist, never the keys themselves)

**Out of scope (v2+):**
- BlogForge's own config / Settings page (currently reads myvoice's config; future PR can fork)
- Publishing pipeline (Hugo / Substack / Ghost / WordPress)
- Conversational chat editing
- Add/remove sections during Stage 3 (only Stage 2 outline can restructure)
- Multi-format outputs (same idea → blog + LinkedIn + Twitter)
- Draft templates
- Collaboration / sharing
- Cost per-draft in the UI (calc exists; UI deferred)
- Live re-lint as the user edits (lint is on-demand only in v1)

---

# Part 1: Repo + dependency on myvoice

BlogForge is a sibling Python project at `/Users/dbbaskette/Projects/BlogForge`. New git repo. Mirrors myvoice's two-package layout.

```
blogforge/
├── README.md
├── pyproject.toml                  # `blogforge` CLI, declares myvoice>=0.1.0 dep
├── Makefile
├── biome.json
├── scripts/
│   ├── install-local.sh            # build wheel + install into local-venv/
│   ├── run-local.sh                # run installed wheel
│   └── dev.sh                      # concurrent backend + Vite dev
├── packages/
│   ├── api/                        # Python backend
│   │   └── blogforge/
│   │       ├── __init__.py         # __version__ + future public surface
│   │       ├── cli.py              # `blogforge serve`, `blogforge version`
│   │       ├── server.py           # FastAPI app factory + lifespan
│   │       ├── drafts/
│   │       │   ├── __init__.py
│   │       │   ├── models.py       # Pydantic: Draft, Section, OutlineProposal, IdeaInput
│   │       │   └── store.py        # DraftStore: filesystem-backed JSON CRUD
│   │       ├── generate/
│   │       │   ├── __init__.py
│   │       │   ├── outline.py      # async propose_outline(idea, provider, model) -> OutlineProposal
│   │       │   ├── section.py      # async stream_section(...) -> AsyncIterator[StreamChunk]
│   │       │   └── prompts/
│   │       │       ├── outline.j2
│   │       │       └── section.j2
│   │       ├── llm/                # provider adapters (copied/adapted from myvoice/llm/)
│   │       │   ├── __init__.py
│   │       │   ├── base.py
│   │       │   ├── exceptions.py
│   │       │   ├── anthropic.py
│   │       │   ├── openai.py
│   │       │   ├── google.py
│   │       │   ├── rates.yaml
│   │       │   ├── rates.py
│   │       │   ├── cost.py
│   │       │   └── registry.py
│   │       ├── jobs/               # JobRegistry + SSE machinery (copied pattern)
│   │       │   ├── __init__.py
│   │       │   ├── models.py
│   │       │   ├── registry.py
│   │       │   └── events.py
│   │       ├── api/                # FastAPI routes
│   │       │   ├── __init__.py
│   │       │   ├── packs.py        # GET /api/packs (wraps myvoice.PackStore)
│   │       │   ├── providers.py    # GET /api/providers (reads ~/.myvoice/config.yaml)
│   │       │   ├── drafts.py       # CRUD for drafts
│   │       │   ├── outline.py      # POST /api/drafts/{id}/outline (sync; small payload)
│   │       │   ├── section.py      # POST /api/drafts/{id}/sections/{section_id}/regenerate (async)
│   │       │   ├── expand.py       # POST /api/drafts/{id}/expand (async; queues all sections)
│   │       │   ├── lint.py         # POST /api/drafts/{id}/lint (sync; wraps myvoice.lint)
│   │       │   ├── download.py     # GET /api/drafts/{id}/download (assembled markdown)
│   │       │   ├── jobs.py         # GET/DELETE /api/jobs/{id} + /events (SSE)
│   │       │   └── events.py       # GET /api/events (draft:* events)
│   │       └── static/             # built frontend bundle (populated by build)
│   └── web/                        # React frontend
│       ├── package.json
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── routes/
│       │   │   ├── DraftsPage.tsx
│       │   │   └── DraftPage.tsx
│       │   ├── components/
│       │   │   ├── AppShell.tsx
│       │   │   ├── NewDraftDialog.tsx
│       │   │   ├── DeleteDraftDialog.tsx
│       │   │   ├── StageIndicator.tsx
│       │   │   └── draft/
│       │   │       ├── Stage1Idea.tsx
│       │   │       ├── Stage2Outline.tsx
│       │   │       ├── Stage3Sections.tsx
│       │   │       ├── SectionCard.tsx
│       │   │       ├── OutlineSectionCard.tsx
│       │   │       └── LintPanel.tsx
│       │   ├── api/
│       │   │   ├── client.ts
│       │   │   ├── drafts.ts
│       │   │   ├── packs.ts
│       │   │   ├── providers.ts
│       │   │   ├── outline.ts
│       │   │   ├── section.ts
│       │   │   ├── lint.ts
│       │   │   └── events.ts
│       │   ├── hooks/
│       │   │   ├── useGlobalEvents.ts
│       │   │   ├── useExpandJob.ts
│       │   │   └── useDebouncedSave.ts
│       │   └── styles/
│       └── tests/
└── e2e/
    └── draft-lifecycle.spec.ts
```

**Dependency on myvoice:** `pyproject.toml` lists `myvoice>=0.1.0`. BlogForge imports only the public names from `myvoice/__init__.py` (post-Phase 7):

```python
from myvoice import PackStore, compose_prompt, lint, validate_pack
from myvoice import Manifest, Violation, LintHit
```

If the user hasn't installed myvoice, BlogForge's pip install fails with a clear "requires myvoice" message. No graceful fallback — myvoice is a hard dep.

**Pack discovery roots:** BlogForge uses the same root resolution as myvoice:
1. `MYVOICE_PACKS_ROOT` env var if set (for tests + dev)
2. `~/.myvoice/packs/` if it exists
3. Repo `packs/` fallback (development only — BlogForge doesn't ship any packs)

BlogForge does NOT support its own pack_paths config in v1. Users' packs live under myvoice.

---

# Part 2: Backend

## 2.1 Data shapes

`packages/api/blogforge/drafts/models.py`:

```python
from datetime import datetime
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, Field

class IdeaInput(BaseModel):
    topic: str = Field(min_length=1)
    bullets: list[str] = Field(default_factory=list)
    pack_slug: str = Field(min_length=1)
    format: str | None = None        # optional pack format name (e.g. "blog-post")
    provider: Literal["anthropic", "openai", "google"]
    model: str
    target_words: int = 1500
    notes: str = ""

class OutlineSection(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    title: str
    brief: str

class OutlineProposal(BaseModel):
    opening_hook: str
    sections: list[OutlineSection]
    estimated_words: int

SectionStatus = Literal["empty", "generating", "ready", "failed", "edited"]

class Section(BaseModel):
    id: str                          # matches OutlineSection.id; stable across regenerations
    title: str
    brief: str
    content_md: str = ""
    status: SectionStatus = "empty"
    last_generated_at: datetime | None = None
    word_count: int = 0

DraftStage = Literal["idea", "outline", "sections"]

class Draft(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    title: str = ""                  # display title; defaults to idea.topic
    stage: DraftStage = "idea"
    idea: IdeaInput
    outline: OutlineProposal | None = None
    sections: list[Section] = Field(default_factory=list)

class DraftSummary(BaseModel):
    """Shape returned by GET /api/drafts (cheap to list)."""
    id: str
    title: str
    stage: DraftStage
    pack_slug: str
    updated_at: datetime
    word_count: int                  # total across all sections
```

## 2.2 DraftStore (filesystem-backed)

`packages/api/blogforge/drafts/store.py`:

```python
class DraftStore:
    """Per-draft directory under ~/.blogforge/drafts/<id>/.
    Each draft dir contains:
      - draft.json   (atomic temp+rename writes)
      - post.md      (always-current assembled markdown snapshot)
    """
    def __init__(self, root: Path) -> None: ...
    def list(self) -> list[DraftSummary]: ...      # cheap: read draft.json headers
    def get(self, draft_id: str) -> Draft | None: ...
    def create(self, idea: IdeaInput) -> Draft: ... # mints id, writes draft.json + empty post.md
    def update(self, draft_id: str, draft: Draft) -> Draft: ...  # atomic write; re-assembles post.md
    def delete(self, draft_id: str) -> None: ...   # moves to <root>/../trash/<ts>-<id>/
    def assemble_markdown(self, draft: Draft) -> str: ...  # opening_hook + per-section "# title\n\n<content>\n\n"
```

Atomic writes use the same temp+fsync+rename pattern as myvoice's `PackStore.save_manifest`. The trash root is `<draft_root>/../trash/` (so it sits next to drafts, not inside).

## 2.3 LLM module

Copied from myvoice's `packages/api/myvoice/llm/` directory (the Phase 4 + Phase 6 code) with minor adaptations:

- Same `LLMProvider` Protocol with `complete(model, prompt, json_schema=None)` and `stream(model, prompt)`.
- Same 3 adapters (Anthropic via tool-use for structured output, OpenAI via `response_format`, Google via `response_schema` with `to_google_schema` adapter).
- Same retry-on-invalid-JSON pattern.
- Same `rates.yaml` (copy verbatim; rates drift between projects is acceptable for v1).
- Same `cost.usd()` calculator.

Why copy and not import: myvoice doesn't expose `llm` publicly (Phase 7 only published `PackStore`, `compose_prompt`, `lint`, `validate_pack`, etc.). Either we expand myvoice's public API (deferred — would couple the projects' release cycles) or duplicate (chosen for v1).

**Future cleanup:** when both myvoice and BlogForge are stable, extract a shared `style-llm` package. Not on the v1 critical path.

## 2.4 Jobs module

Same pattern as myvoice's `packages/api/myvoice/jobs/` — copied verbatim:

- `Job` (id, type, status, stage, partial_text, result, error)
- `JobRegistry` with LRU eviction, cancellation events, listener queues, replay snapshots
- `JobType.EXPAND` for the per-section expansion jobs (replaces myvoice's REWRITE)

`/api/jobs/{id}/events` SSE endpoint same shape as myvoice. Drives the streaming UI.

## 2.5 Generate module

### Outline generation (`generate/outline.py`)

Single LLM call with `json_schema=OutlineProposal.model_json_schema()`. Sync from the user's POV — no SSE, just a regular `await` that returns the proposal directly. (Outline is small and fast — streaming it adds complexity for no gain.)

```python
async def propose_outline(
    *, idea: IdeaInput, pack: PackInfo, provider: LLMProvider, model: str,
) -> OutlineProposal:
    # Build the system context from the pack (voice rules, samples)
    system = compose_prompt(
        pack_root=pack.root_path,
        format=idea.format,
        samples=auto_pick_top_samples(pack, n=2),
        draft=None,
    )
    user_prompt = render_outline_template(idea=idea)
    schema = OutlineProposal.model_json_schema()
    response = await provider.complete(
        model=model,
        prompt=f"{system}\n\n{user_prompt}",
        json_schema=schema,
    )
    return OutlineProposal.model_validate_json(response.text)
```

The `auto_pick_top_samples()` helper picks the lowest-numbered N samples from the pack's manifest (the user ordered them by rank when authoring; Phase 6's Extract proposes them ranked).

### Section expansion (`generate/section.py`)

Streams via `provider.stream()`. Per-section LLM call. The section prompt includes the full outline as context so the LLM knows where this section sits in the arc.

```python
async def stream_section(
    *, draft: Draft, section: Section, pack: PackInfo,
    provider: LLMProvider, model: str,
) -> AsyncIterator[StreamChunk]:
    system = compose_prompt(pack_root=pack.root_path, format=draft.idea.format,
                            samples=auto_pick_top_samples(pack, n=3), draft=None)
    user_prompt = render_section_template(draft=draft, section=section)
    async for chunk in provider.stream(model=model, prompt=f"{system}\n\n{user_prompt}"):
        yield chunk
```

`render_section_template` substitutes:
- `{{ outline }}` — markdown bullet list of all sections with the current one bolded
- `{{ section_title }}` and `{{ section_brief }}`
- `{{ target_section_words }}` — `draft.idea.target_words / len(draft.sections)`
- `{{ position }}` — "section 3 of 7"
- `{{ is_first }}` / `{{ is_last }}` — booleans for opener/closer cues

### Prompt templates

`generate/prompts/outline.j2`:
```
You are planning a blog post in the author's voice (described in the system context above). The author's banished words / phrases / rules are non-negotiable.

Topic: {{ idea.topic }}

{% if idea.bullets %}
Supporting points the author wants to make:
{% for b in idea.bullets %}- {{ b }}
{% endfor %}{% endif %}

{% if idea.notes %}Notes: {{ idea.notes }}{% endif %}

Target length: ~{{ idea.target_words }} words total.

Propose a complete outline as a JSON object matching the schema:
- opening_hook: one sentence that opens the post (Conflict & Resolution style if the voice uses that pattern)
- sections: 5-9 entries; each with a short H2-style `title` and a 1-3 sentence `brief` describing what the section argues
- estimated_words: your honest estimate of total prose length

Use the author's voice. Banished words/phrases never appear.
```

`generate/prompts/section.j2`:
```
You are writing section {{ position }} of a blog post titled "{{ draft.title or draft.idea.topic }}".

Full outline (current section marked **bold**):
{{ outline }}

Opening hook of the post: {{ draft.outline.opening_hook }}

This section's title: {{ section_title }}
This section's brief: {{ section_brief }}
Target length: ~{{ target_section_words }} words.

Write the section as flowing markdown prose. Do NOT include the section title as a heading; the renderer adds it. {% if is_first %}This is the OPENING section — establish the conflict/question/surprise.{% elif is_last %}This is the CLOSING section — land the argument; the brief above tells you the closing beat.{% else %}Open and close mid-thought; flow into the next section.{% endif %}

Use the author's voice. Banished words/phrases never appear.
```

## 2.6 HTTP routes

```
GET    /api/packs                                  # wraps myvoice.PackStore
GET    /api/providers                              # [{ "anthropic": true, "openai": false, "google": true }]
                                                   # reads ~/.myvoice/config.yaml; never returns keys
GET    /api/providers/{provider}/models            # proxies to myvoice's listing pattern;
                                                   # provider's key fetched from ~/.myvoice/config.yaml internally

GET    /api/drafts                                 # → list[DraftSummary]
POST   /api/drafts                                 # body: IdeaInput → 201 Draft
GET    /api/drafts/{id}                            # → Draft (full)
PUT    /api/drafts/{id}                            # body: partial Draft → 200 Draft (autosave target)
DELETE /api/drafts/{id}                            # → 204; soft-delete to trash

POST   /api/drafts/{id}/outline                    # sync; runs propose_outline; returns updated Draft
                                                   # also acceptable for "regenerate outline"

POST   /api/drafts/{id}/expand                     # async; queues all empty/failed sections for expansion
                                                   # → 202 { job_id }
POST   /api/drafts/{id}/sections/{section_id}/regenerate
                                                   # async; queues just this section
                                                   # → 202 { job_id }

POST   /api/drafts/{id}/sections/{section_id}/save # body: { content_md } → 200; sets status=edited
POST   /api/drafts/{id}/sections/reorder           # body: { section_ids: [...] } → 200 Draft

GET    /api/drafts/{id}/download                   # → 200 text/markdown; assembled post.md
POST   /api/drafts/{id}/lint                       # → { violations: LintHit[], hits: LintHit[] }
                                                   # wraps myvoice.lint over assembled markdown

GET    /api/jobs/{id}                              # snapshot
DELETE /api/jobs/{id}                              # cancel
GET    /api/jobs/{id}/events                       # SSE

GET    /api/events                                 # global SSE: draft:created, draft:updated, draft:deleted
```

### Expand-all flow

`POST /api/drafts/{id}/expand`:
1. Validates draft is in `outline` stage (has an outline).
2. Creates a single Job of type `EXPAND` for the whole draft.
3. Background task spawns up to 2 concurrent section streams (semaphore). For each section:
   - Push `stage` event: `{type:"stage", name:"section:start", section_id, title}`.
   - Stream via `provider.stream(...)`, push each delta as `{type:"section_token", section_id, delta}`.
   - On section completion, update Draft.sections[i] (content_md, status=ready, word_count, last_generated_at), persist, push `{type:"stage", name:"section:done", section_id, word_count}`.
4. On all sections complete: push `{type:"complete", result: {draft_id, sections_done, sections_failed}}`.
5. Per-section failures continue (don't abort the job). Failed sections get `status=failed` with the error.

### Per-section regenerate flow

`POST /api/drafts/{id}/sections/{section_id}/regenerate`:
1. Creates a Job of type `EXPAND` (single section). Same SSE shape; the frontend filters by `section_id`.
2. Sets the target section's `status=generating`, persists.
3. Streams the section, replaces `content_md`, sets `status=ready` on completion.

## 2.7 Error envelope

Same shape as myvoice's:
```json
{"error": {"code": "...", "message": "...", "hint": "..."}}
```

Codes used:
- `draft_not_found` (404)
- `section_not_found` (404)
- `invalid_stage` (409 — e.g., expand called before outline approved)
- `pack_not_found` (404 — pack referenced in idea no longer exists)
- `provider_missing_key` (400)
- `provider_rate_limit` (429)
- `provider_error` (502)
- `analyze_invalid_json` (502 — outline LLM returned malformed structure twice)
- `job_not_found` (404)

---

# Part 3: Frontend

## 3.1 Routes

```
/                    DraftsPage   — list recent drafts + + New draft
/drafts/:id          DraftPage    — 3-stage workflow per draft
```

No /settings route in v1.

## 3.2 AppShell

Simple top bar with the BlogForge wordmark + a link back to "Drafts." Single-route app effectively; AppShell is thin.

## 3.3 DraftsPage (home)

Header: `BlogForge` wordmark + `+ New draft` button (top right).

Recent drafts list:
```
● Building AI Agents That Don't Suck       [dan]  Sections · 1,847 words
   Updated 12m ago

● How I Stopped Worrying About Tests       [dan]  Outline  · idea-only
   Updated 3h ago
```

Each row clickable to `/drafts/:id`. Right-side overflow menu: Delete.

If `~/.myvoice/config.yaml` has no provider keys, banner above the list:
```
No API keys found in myvoice. Open Settings in myvoice (localhost:7878) to add one.
```
Banner doesn't block — user can still browse / delete existing drafts.

### NewDraftDialog

Modal with the minimal Stage 1 form:
- Topic (required)
- Pack picker (required; sourced from `/api/packs`)
- Provider + model (required; pick from `/api/providers` available list)
- Target words slider (default 1500)
- "Create draft" button — POSTs to `/api/drafts`, navigates to `/drafts/:id`.

Bullets, format, and notes are filled in on the Stage 1 page after creation. Keeps the dialog narrow.

## 3.4 DraftPage

Sticky top: `StageIndicator` showing the 3 dots [Idea] — [Outline] — [Sections]. Clickable to navigate backwards (going back invalidates downstream content with a confirm).

Body renders one of:
- `<Stage1Idea draft={draft} onChange={save} onAdvance={generateOutline} />`
- `<Stage2Outline draft={draft} onChange={save} onAdvance={expandAll} onRegenerateOutline={...} />`
- `<Stage3Sections draft={draft} onChange={save} onRegenerateSection={...} expandJobId={...} />`

### Stage 1: Idea

Full Stage 1 form (topic + bullets + pack + format + provider + model + target_words + notes). Auto-save on every change via `useDebouncedSave` (500ms debounce → PUT `/api/drafts/{id}`).

Bottom: "Generate outline →" button (disabled until topic + pack + provider + model are valid). Click → POST `/api/drafts/{id}/outline` → updates draft.outline + stage=`outline` → render Stage 2.

### Stage 2: Outline

Top of body: Opening hook (inline-editable text input).

Below: section cards, drag-handle reorderable. Each card:
- Title (inline editable)
- Brief (inline editable, 2-line textarea)
- × button (remove)

Bottom: `+ Add section` button (adds empty section with placeholder text).

Footer actions:
- "← Back to idea" (resets stage to `idea`; outline + sections preserved but hidden)
- "Regenerate outline" (re-runs `propose_outline`; confirm dialog if outline edited)
- "Expand all sections →" — POST `/api/drafts/{id}/expand`, transitions to Stage 3, starts SSE.

Auto-save on every edit.

### Stage 3: Sections

Header: title (editable) + draft meta (pack, model, total word count).

`SectionCard` per section, in outline order. Each card:
- Title (display from outline; not editable here)
- Status icon (●○✓✗*) + word count
- Tiptap editor with `content_md` (initialized via `marked.parse` like myvoice's editor)
- Footer: "Regenerate this section" + "Save" (only enabled when edited)

While the expand job is running (jobId set):
- Sections with `section:start` events show the spinner
- `section_token` events append to a buffer; the card renders streaming text in a read-only `<pre>` overlay
- `section:done` switches to the editable Tiptap with final content_md

Sticky footer:
- Total word count
- "Copy markdown" button (copies output of `assemble_markdown`)
- "Download .md" link (`/api/drafts/{id}/download`)
- "Lint full doc" button (opens `LintPanel` slide-in from right)

`LintPanel`: list of violations + positive hits from `POST /api/drafts/{id}/lint`. Grouped by section. Click an entry to scroll the section into view + highlight the offending text (best-effort: highlight by string match in the Tiptap content).

## 3.5 useExpandJob hook

```typescript
interface ExpandJobHandlers {
  onSectionStart: (sectionId: string) => void;
  onSectionToken: (sectionId: string, delta: string) => void;
  onSectionDone: (sectionId: string, wordCount: number) => void;
  onComplete: (result: ExpandResult) => void;
  onError: (code: string, message: string) => void;
}
export function useExpandJob(jobId: string | null, handlers: ExpandJobHandlers): void;
```

Wraps EventSource for `/api/jobs/{id}/events`. Dispatches by event type. Closes on terminal events.

## 3.6 useDebouncedSave hook

```typescript
export function useDebouncedSave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  delay: number = 500,
): { saving: boolean; lastSavedAt: Date | null };
```

Generic debounced save hook used by Stages 1, 2, and per-section save in Stage 3.

---

# Part 4: Testing

## 4.1 Backend (pytest)

- `tests/drafts/test_store.py` — DraftStore CRUD: create + persist, list, update, delete-to-trash, assemble_markdown
- `tests/llm/test_anthropic.py`, `test_openai.py`, `test_google.py` — same shape as myvoice's structured-output tests; respx-mocked
- `tests/generate/test_outline.py` — mock provider returning canned OutlineProposal JSON; verify prompt renders correctly
- `tests/generate/test_section.py` — mock provider streaming; verify chunks aggregate correctly
- `tests/api/test_drafts_route.py` — CRUD + list
- `tests/api/test_outline_route.py` — happy path + invalid_stage 409
- `tests/api/test_expand_route.py` — 202 + job_id; SSE drain yields section_token + section:done events; failed-section path
- `tests/api/test_section_regenerate_route.py` — single-section flow
- `tests/api/test_section_save_route.py` — sets status=edited
- `tests/api/test_lint_route.py` — wraps myvoice.lint correctly
- `tests/api/test_download_route.py` — assembled markdown returned with proper Content-Type
- `tests/api/test_providers_route.py` — reads `~/.myvoice/config.yaml`, returns availability without leaking keys

## 4.2 Frontend (Vitest)

- `components/draft/Stage1Idea.test.tsx` — form fields, auto-save debounce, gating
- `components/draft/Stage2Outline.test.tsx` — reorder, inline edit, add section, regenerate confirm
- `components/draft/Stage3Sections.test.tsx` — section status transitions, streaming display, edit + save
- `components/NewDraftDialog.test.tsx` — minimum-fields gating, success navigation
- `hooks/useExpandJob.test.ts` — dispatches stage/token/complete/error correctly
- `hooks/useDebouncedSave.test.ts` — debounce timing, cancel on unmount

## 4.3 E2E (Playwright)

`e2e/draft-lifecycle.spec.ts`:
1. Visit `/`. Click `+ New draft`. Fill form with mock-provider-friendly values. Submit → navigate to `/drafts/:id`.
2. Verify Stage 1 form rendered.
3. Click "Generate outline →". Outline LLM call returns canned JSON via mock provider. Verify Stage 2 renders with 5 sections.
4. Edit one section title. Click "Expand all sections →". Verify Stage 3 renders, all sections stream in, all reach status=ready.
5. Edit one section content. Click Save. Verify status=edited (* marker).
6. Click "Download .md". Verify response body contains the assembled markdown.
7. (Optional, if backend allows) Click "Regenerate this section" for one section. Verify spinner → ready transition.

Same mock-provider pattern as myvoice: `MYVOICE_TEST_PROVIDER=mock` (or `BLOGFORGE_TEST_PROVIDER=mock`) plus `MYVOICE_MOCK_OUTPUT_JSON` for the outline and `MYVOICE_MOCK_OUTPUT` for streamed section text.

---

# Part 5: PR sequence (estimated 10 PRs)

Bottom-up by layer. Each PR <500 LOC where possible.

```
PR1   chore: scaffold blogforge repo (pyproject + Makefile + scripts + README + biome + CI)
PR2   feat(api): copy myvoice's LLM module (3 providers + structured output + retry)
PR3   feat(api): copy myvoice's jobs module (JobRegistry + SSE)
PR4   feat(api): drafts/models.py + drafts/store.py + GET/POST/PUT/DELETE /api/drafts
PR5   feat(api): GET /api/packs + GET /api/providers + /api/providers/{p}/models (myvoice integration)
PR6   feat(api): generate/outline.py + POST /api/drafts/{id}/outline
PR7   feat(api): generate/section.py + POST /api/drafts/{id}/expand + section/regenerate + section/save
PR8   feat(api): /api/drafts/{id}/download + /lint + /events
PR9   feat(web): scaffold + AppShell + DraftsPage + NewDraftDialog
PR10  feat(web): DraftPage 3-stage workflow (Stage1Idea + Stage2Outline + Stage3Sections + SectionCard)
PR11  test(e2e): Playwright draft-lifecycle + README screenshots
```

Actually 11. Comparable to myvoice Phase 6.

---

# Part 6: Done-state

- [ ] `make test` green (pytest + Vitest + Playwright)
- [ ] mypy strict + ruff + biome + tsc all clean
- [ ] `pipx install ./dist/blogforge-0.1.0-py3-none-any.whl && blogforge serve` opens browser at `:7880`
- [ ] With a real Claude key in `~/.myvoice/config.yaml`: create a new draft for a real topic, generate outline, edit a section title, expand all sections, edit one section by hand, regenerate another, download the .md, open the .md file — content is coherent, in voice, no banished words
- [ ] Drafts persist across server restarts; home page lists them with correct stage indicators
- [ ] All 3 LLM providers' mocked tests pass; opt-in live tests pass against real keys
- [ ] `from blogforge import ...` is not yet a public API (v1 is app-only)
- [ ] README has install + first-run + a screenshot of the 3-stage flow

---

# Part 7: Out of scope (v2+)

- BlogForge's own config (default pack, default provider) — currently per-draft only
- BlogForge Settings page (would manage BlogForge's own config above)
- Publishing pipeline (Hugo / Substack / Ghost / WordPress)
- Conversational chat editing
- Add/remove sections during Stage 3 (only Stage 2 outline restructures)
- Multi-format outputs
- Draft templates
- Collaboration / sharing
- Cost per-draft in the UI
- Live re-lint during edit (lint is on-demand only)
- BlogForge as a Python library (`from blogforge import ...`) — app-only in v1
- Brand frontmatter (title/date/slug/tags YAML at the top of the download)
- Multi-pack drafting (one pack per draft in v1)
