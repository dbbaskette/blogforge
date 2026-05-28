# Research stage + references — design (v2: SQL + S3)

**Date:** 2026-05-28
**Status:** Approved (shape) · implementation plan to follow
**Supersedes:** `2026-05-27-research-stage-and-references-design.md` (file-based storage; obsoleted by the Phase A migration to Postgres + S3)
**Companion to:** Phase A (`2026-05-27-auth-multi-tenant-postgres-design.md`)

## What changed since v1

Phase A replaced the JSON-on-disk `DraftStore` with a Postgres `SqlDraftStore` and stood up MinIO/S3 for object storage. The v1 spec described references as files under `~/.pencraft/drafts/<id>/references/`. That path no longer exists. Everything user-scoped now lives in the DB or S3.

This document re-specs the storage and data model accordingly. The **workflow**, **UI**, **prompts**, **endpoints**, **extraction**, and **error handling** are unchanged from v1 except where they touch the storage layer — re-read v1 for those sections.

## Motivation (unchanged)

Stage 1 ("Idea") is a static form: topic, bullets, notes, then *Generate outline*. No way to ground the LLM in source material the writer cares about, no back-and-forth refinement. This replaces Stage 1 with a **Research** stage modeled on `video-production-assistant`'s ideation flow: add references (URLs / text / files), converse with the LLM until a proposed outline feels right, accept it to advance into the existing outline-edit stage. References stay attached to the draft and inform every subsequent LLM call.

## Workflow (unchanged)

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  1. RESEARCH    │     │  2. OUTLINE  │     │  3. SECTIONS     │
│  (new)          │ ──> │  (existing)  │ ──> │  (existing)      │
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

References are visible in Stages 2 and 3 as a collapsible right-rail card.

## Data model (revised for SQL)

### New table: `references`

```python
class Reference(Base):
    __tablename__ = "references"

    id:                Mapped[str]      = mapped_column(String(64), primary_key=True)  # "ref-<uuid7-ish>"
    draft_id:          Mapped[UUID]     = mapped_column(Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    kind:              Mapped[str]      = mapped_column(String(8), nullable=False)  # "url" | "file" | "text"
    name:              Mapped[str]      = mapped_column(String(500), nullable=False)
    url:               Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    extracted_chars:   Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    added_at:          Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

Scoping: every API call resolves the draft first via the existing `SqlDraftStore.get(draft_id, user_id=...)` path, so cross-user reads are already impossible. The `ON DELETE CASCADE` to drafts means soft-deleting (or hard-deleting) a draft purges its references too.

### New table: `ideation_messages`

```python
class IdeationMessage(Base):
    __tablename__ = "ideation_messages"

    id:                Mapped[str]      = mapped_column(String(64), primary_key=True)
    draft_id:          Mapped[UUID]     = mapped_column(Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    position:          Mapped[int]      = mapped_column(Integer, nullable=False)  # 0-based; UNIQUE (draft_id, position)
    role:              Mapped[str]      = mapped_column(String(16), nullable=False)  # "user" | "assistant"
    content:           Mapped[str]      = mapped_column(Text, nullable=False)
    proposed_outline:  Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timestamp:         Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("draft_id", "position", name="uq_ideation_position"),)
```

JSON column for `proposed_outline` mirrors how `drafts.outline` is stored. No separate `ideation_sessions` table — a session is just *the ordered list of messages for a draft*, computed via `SELECT ... WHERE draft_id=... ORDER BY position`.

### `Draft` ORM + pydantic

Both gain `references: list[Reference] = []` and `ideation_messages: list[IdeationMessage] = []` (loaded lazily via relationship). The pydantic `Draft.idea` field stays — it's the seed (topic, bullets, notes, pack, provider, model, target words) that bootstraps the conversation. The first user `IdeationMessage` is auto-generated from `idea` on first ideation send if the message list is empty.

### Stage rename: `idea` → `research`

The Phase A `0001_initial` migration set `stage` default to `"idea"`. We:

1. Add migration `0003_stage_rename`:
   - `UPDATE drafts SET stage = 'research' WHERE stage = 'idea';`
   - `ALTER COLUMN stage SET DEFAULT 'research';` (Postgres) / no-op on SQLite (defaults are baked at insert time).
2. Update `DraftStage` literal in pydantic: `Literal["research", "outline", "sections"]`.
3. Backwards-compat API shim: incoming `stage: "idea"` in PUT bodies is silently coerced to `"research"` for the transition window. Drop after the next deploy.

## Storage layout (S3)

Per draft, in the configured bucket (`Settings.s3_bucket`, default `pencraft`):

```
drafts/{draft_id}/references/
  originals/
    {ref_id}.{ext}            # raw upload (file kind), or `url-stub.txt` carrying the URL (url kind)
  extracted/
    {ref_id}.md               # cleaned markdown the LLM sees (all kinds)
```

No top-level `manifest.json` — the `references` table is the source of truth for metadata. Originals are kept for audit / re-extraction.

**Lifespan setup.** A new `pencraft.s3.ensure_bucket()` runs at boot (after migrations, before the app accepts requests) to create the bucket if missing. Local dev (MinIO) and CF (SeaweedFS) both need this.

**Client.** A new `pencraft.s3.S3Client` wraps `aiobotocore` with three methods we'll need: `put_object(key, body, content_type)`, `get_object(key) -> bytes`, `delete_prefix(key_prefix)`. Lifecycle: a single session per process, lazily-built; the same singleton pattern as `get_engine` / `get_sessionmaker`.

## Extraction (unchanged from v1)

| Kind  | Extractor    | Notes |
|-------|--------------|-------|
| URL   | `trafilatura` | Existing transitive dep. Plain-HTML fallback if extraction empty. |
| `.md` | identity     | UTF-8. |
| `.txt`| identity     | UTF-8. |
| `.pdf`| `pypdf`      | **New dep.** Pure-Python, no system libs. |
| text  | identity     | User-pasted. |

Limits: 5 MB raw / 200k extracted chars per ref. Anything larger → HTTP 413.

## Endpoints (unchanged shape, gated by `get_current_user`)

All under `/api/drafts/{id}/`. Auth is implicit — every handler depends on `get_current_user` and looks the draft up via `SqlDraftStore.get(..., user_id=current.id)` so cross-user access 404s.

| Method | Path | Body | Result |
|---|---|---|---|
| GET    | `references`             | —                                       | `Reference[]` |
| POST   | `references/url`         | `{ url: str, name?: str }`               | `Reference` (8s fetch timeout) |
| POST   | `references/text`        | `{ name: str, content: str }`            | `Reference` |
| POST   | `references/file`        | `multipart` (`file`, `name?`)            | `Reference` |
| DELETE | `references/{ref_id}`    | —                                       | 204 (also deletes both S3 objects) |
| POST   | `ideation/message`       | `{ content: str }`                       | SSE → final assistant message persisted; `{ job_id }` |
| POST   | `ideation/accept`        | —                                       | Updated `Draft` (stage → outline, outline populated) |
| GET    | `ideation`               | —                                       | `IdeationMessage[]` (full conversation, for reload) |

The ideation stream reuses the existing `JobRegistry` + SSE pattern from section expansion. One in-flight ideation job per draft enforced server-side (409 on collision).

## Prompt construction (revised: async S3 fetch)

New helper `pencraft/generate/references.py`:

```python
REFERENCE_BUDGET_CHARS = 30_000

async def get_reference_context(draft: Draft, s3: S3Client) -> str:
    """Return a '## Reference Materials\\n\\n…' block, '' when no refs."""
    refs = draft.references
    if not refs:
        return ""
    bodies = await asyncio.gather(*[
        s3.get_object(f"drafts/{draft.id}/references/extracted/{r.id}.md") for r in refs
    ])
    total = sum(r.extracted_chars for r in refs) + len(refs) * 80
    if total <= REFERENCE_BUDGET_CHARS:
        return _concat(refs, bodies)
    return _concat(refs, bodies, per_doc_budget=max(500, (REFERENCE_BUDGET_CHARS - len(refs)*80) // len(refs)))
```

Call sites: `generate/outline.py`, `generate/section.py`, and the new `generate/ideation.py`. All become async-aware (some already are).

System prompt for ideation — verbatim from v1, unchanged.

## UI components (unchanged from v1)

- **New:** `ResearchPanel.tsx`, `ReferencesList.tsx`, `AddReferenceForm.tsx`
- **Updated:** `DraftWorkspace.tsx`, `DraftsPage.tsx`, `OutlineSidebar.tsx`, `StatusPill`
- **Removed:** `IdeaPanel.tsx` (bullets/notes from `idea` get seeded into the first user ideation message)

## Job streaming (unchanged)

`JobRegistry` gets a new job kind `"ideation"`. New `useStreamJob({ onDelta, onResult, onError })` hook on the web side. Frame shapes are identical to section expansion.

## Error handling (largely unchanged)

| Failure | Surface |
|---|---|
| URL fetch fails | 422 `url_fetch_failed` |
| URL extraction empty | Save with `extracted_chars: 0` + toast warning |
| File too large | 413 `file_too_large` |
| Unsupported file ext | 415 `unsupported_file_type` |
| Ideation reply missing JSON block | Save message, `proposed_outline=null`, Accept disabled |
| Ideation reply has malformed JSON | Same; log parse error |
| Reference S3 fetch fails during composition | Skip the ref, prompt still goes through, server logs warning |
| **NEW: S3 not configured / bucket missing at boot** | Lifespan exits 1 with `s3_bucket_unavailable` |
| **NEW: stale reference (DB row exists, S3 object missing)** | Skip during composition + log; the next add of that ref kind silently overwrites the orphan |

## Testing

### API (pytest)

- `test_references_url.py` — mock `trafilatura.fetch_url`; add → list → delete cycle; prompt-injector picks up extracted content from S3.
- `test_references_file.py` — upload `.md`, `.txt`, small `.pdf`; assert extracted markdown.
- `test_references_text.py` — pasted text round-trips.
- `test_references_budget.py` — 5 refs × 10k chars; assert truncation under 30k preserves each ref's head.
- `test_references_scoped_by_user.py` — user A can't list/get/add/delete refs on user B's draft.
- `test_s3_client.py` — put/get/delete_prefix round-trip against a `moto` mock S3 (new dev dep).
- `test_ideation_round_trip.py` — mock LLM emits fixed reply + JSON; message persisted, `proposed_outline` parsed, `/accept` populates `draft.outline` and flips stage.
- `test_stage_migration.py` — load a draft with `stage="idea"` (pre-migration); after migration, stage is `"research"`. Also test the API-level shim that coerces incoming `"idea"`.

### Web (vitest)

- `ResearchPanel.test.tsx` — renders chat + outline preview; Accept disabled until a `proposed_outline` arrives.
- `ReferencesList.test.tsx` — add / remove flows hit the right endpoints.
- `DraftWorkspace.test.tsx` — at `stage="research"` mounts ResearchPanel; at `outline`/`sections` shows the collapsible ReferencesList.

### e2e (deferred)

Playwright spec for the full research → outline → sections flow with a mocked LLM. Out of scope for the implementation PR.

## Out of scope (v1, unchanged)

- Per-section reference pinning. Refs apply globally to all calls.
- Web search inside ideation. References must be user-supplied.
- Reference re-fetch / freshness tracking.
- Image / screenshot references (needs vision models).
- Citation mode (LLM cites refs in the prose).
- Editing extracted markdown by hand.

## Risks

- **`pypdf` dep creep.** Pin to a recent version; guard with an import-time check that emits a clear "PDFs not supported in this install" error if missing, so the rest of the feature still ships.
- **Ideation JSON drift.** Parse leniently (extra keys allowed, coerce stringly-typed integers); on parse failure show the assistant text and keep Accept disabled with a "the model didn't include a structured outline — ask it to" hint.
- **Big extractions blow the prompt budget.** 30k chars × 9 section calls = ~270k tokens just on refs across a draft. The budget is intentionally conservative; we proportionally truncate; per-call summarisation can come later.
- **Stage rename breaks tests & hardcoded literals.** `grep -rn '"idea"\|'\\''idea'\\''' packages/` before merging; covered by `test_stage_migration.py`.
- **NEW: S3 latency in the hot path.** Reference fetch is now N round-trips per outline/section call. Mitigation: `asyncio.gather` to fan out, S3 client uses keep-alive, and we can add an in-process LRU cache keyed by `(draft_id, ref_id, added_at)` if profiling shows it matters.
- **NEW: MinIO/SeaweedFS compatibility quirks.** aiobotocore is S3-canonical but the storage backends are S3-compatible-ish. Mitigation: integration test against MinIO in CI (already running locally for docker-compose dev); avoid features beyond `put_object` / `get_object` / `delete_object` / `list_objects_v2`.
- **NEW: Orphaned S3 objects on draft hard-delete.** Soft-delete leaves both DB rows and S3 objects in place (fine — restore works). Hard-delete needs to walk the prefix and delete-many; covered in the `delete_draft` route update.

## Open questions

None outstanding. Shape approved; implementation plan to follow as `2026-05-28-research-stage-references-implementation-plan.md`.
