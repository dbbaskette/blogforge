# Research stage + references — implementation plan

**Spec:** `docs/superpowers/specs/2026-05-28-research-stage-references-v2-design.md` (v2, SQL+S3).
**Branch:** `research-stage-references`.
**Discipline:** TDD per task — failing test → green test → commit. Every commit keeps the suite green. Each commit message footer includes `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

Estimated 33 tasks across 8 sections, ~1.5–2× the Phase A surface (more new modules, similar test count). Section 1 is the critical foundation — everything downstream depends on the S3 client landing cleanly.

## Pre-flight

- [ ] Verify branch `research-stage-references` doesn't exist remotely; create locally.
- [ ] Baseline: `uv run pytest packages/api/tests -q` reports 148 passed (post Phase A + admin-keys).
- [ ] Confirm `docker compose ps` shows minio healthy (we'll need it for integration tests).

---

## Section 1 — S3 foundation

### Task 1: Add pypdf + moto deps

**Files:** `pyproject.toml`, `uv.lock`

- pypdf >= 5.0 (runtime).
- moto[s3] >= 5.0 (dev). Used for unit-testing the S3 client without spinning up MinIO.
- `uv lock`; `uv sync --all-extras --dev`; smoke-import both.
- Commit: `deps: pypdf for PDF refs, moto for S3 unit tests`.

### Task 2: Async S3 client (`blogforge.s3.client`)

**Files:** `packages/api/blogforge/s3/__init__.py`, `packages/api/blogforge/s3/client.py`, `packages/api/tests/test_s3_client.py`

**Surface:**
```python
class S3Client:
    async def put_object(self, key: str, body: bytes, content_type: str = "application/octet-stream") -> None: ...
    async def get_object(self, key: str) -> bytes: ...
    async def delete_object(self, key: str) -> None: ...
    async def delete_prefix(self, prefix: str) -> int: ...   # returns count deleted
    async def head_object(self, key: str) -> bool: ...        # exists?

def get_s3_client() -> S3Client: ...   # lru_cache singleton, builds from Settings
def reset_s3_client_for_tests() -> None: ...
```

**Tests** (against `moto[s3]` in-process):
- Round-trip put/get/delete.
- delete_prefix removes all matching keys + reports count.
- head_object returns False for missing key.
- Wrong bucket / wrong creds → raises a typed `S3Error`.

**Acceptance:** new tests pass; full suite still green.

### Task 3: `ensure_bucket()` + lifespan wiring

**Files:** `packages/api/blogforge/s3/lifespan.py`, `packages/api/blogforge/server.py`

- `async def ensure_bucket() -> None` — creates `Settings.s3_bucket` if it doesn't exist; idempotent.
- Lifespan: after migrations, before admin seed, call `await ensure_bucket()`.
- Tests: unit-test against moto; smoke that lifespan_context completes against a fresh MinIO via docker stack.

**Acceptance:** `./scripts/start.sh` brings stack up clean; bucket visible at `http://localhost:9001` MinIO console.

---

## Section 2 — Data model + migration

### Task 4: ORM models — `Reference`, `IdeationMessage`

**Files:** `packages/api/blogforge/db/models.py`, `packages/api/tests/test_db_models.py`

Per spec §"Data model". CASCADE delete to `drafts`. UNIQUE `(draft_id, position)` on `ideation_messages`. Tests assert insert/select round-trip with relationships.

### Task 5: Pydantic models

**Files:** `packages/api/blogforge/drafts/models.py`, `packages/api/blogforge/references/__init__.py`

- New pydantic `Reference`, `IdeationMessage`, `IdeationSession` types.
- `Draft` gains `references: list[Reference] = []` and `ideation_messages: list[IdeationMessage] = []`.
- `DraftStage` literal: `"research" | "outline" | "sections"`.

### Task 6: Migration 0003 — stage rename + new tables

**Files:** `packages/api/alembic/versions/0003_research_stage_and_refs.py`

Upgrade:
1. Create `references` table.
2. Create `ideation_messages` table.
3. `UPDATE drafts SET stage = 'research' WHERE stage = 'idea';`
4. Change `stage` column default to `'research'`.

Downgrade: drop new tables; reverse the UPDATE; restore default.

**Acceptance:** `BLOGFORGE_DATABASE_URL=sqlite:////tmp/test.db uv run alembic upgrade head` shows tables; existing tests still pass.

### Task 7: `SqlDraftStore` loads references + ideation

**Files:** `packages/api/blogforge/drafts/sql_store.py`, `packages/api/tests/test_drafts_scoped_by_user.py`

- `_draft_from_row` populates `references` + `ideation_messages` (eager load via `selectinload`).
- Cross-user scoping tests gain assertions: A can't see B's references.

---

## Section 3 — References API

### Task 8: Extractors module

**Files:** `packages/api/blogforge/references/extractors.py`, `packages/api/tests/test_extractors.py`

- `extract_url(url: str) -> ExtractionResult` — trafilatura + 8s timeout. Returns name (from `<title>`), extracted markdown.
- `extract_file(filename: str, raw: bytes) -> ExtractionResult` — dispatch on extension: `.md`/`.txt` identity, `.pdf` via pypdf; reject others with `UnsupportedFileType`.
- `extract_text(name: str, content: str) -> ExtractionResult` — identity.
- All return `{name, extracted: str, extracted_chars: int}`; respect the 200k char cap with a `[truncated]` marker.

### Task 9: POST /api/drafts/{id}/references/url

**Files:** `packages/api/blogforge/api/references.py`, `packages/api/blogforge/server.py`, `packages/api/tests/test_references_url.py`

- Auth-gated via `get_current_user`, draft scoped.
- Generates `ref_id`, calls extractor, writes `originals/{ref_id}.url-stub.txt` + `extracted/{ref_id}.md` to S3 in one `asyncio.gather`, persists `Reference` row.
- Mock trafilatura in tests; round-trip add → list → assert content visible in `get_reference_context`.

### Task 10: POST /api/drafts/{id}/references/text

**Files:** same router; new tests `test_references_text.py`.

Pasted-content variant. No extraction needed.

### Task 11: POST /api/drafts/{id}/references/file

**Files:** same router; new tests `test_references_file.py`. Fixture: 1-page PDF in `tests/fixtures/`.

`multipart/form-data` upload; 5 MB raw cap. Extension dispatch.

### Task 12: DELETE /api/drafts/{id}/references/{ref_id}

**Files:** same router; tests added to `test_references_url.py`.

DELETE row + `delete_prefix` the S3 namespace for that ref (`drafts/{draft_id}/references/*/{ref_id}.*`). 204.

### Task 13: GET /api/drafts/{id}/references

**Files:** same router; tests in `test_references_url.py`.

Lists references for the draft, ordered by `added_at`.

### Task 14: Cross-user scoping test

**Files:** `packages/api/tests/test_references_scoped_by_user.py`

User A creates draft + ref. User B's GET/POST/DELETE on it all return 404 (not 403 — don't leak existence).

---

## Section 4 — Prompt injection

### Task 15: `get_reference_context` helper

**Files:** `packages/api/blogforge/generate/references.py`, `packages/api/tests/test_references_budget.py`

- Async, takes `Draft` + `S3Client`, returns the formatted block or `""`.
- Tests cover: empty refs → empty string; under budget → full content; over budget → proportional per-ref truncation.

### Task 16: Wire into outline + section generators

**Files:** `packages/api/blogforge/generate/outline.py`, `packages/api/blogforge/generate/section.py`, existing tests in `test_outline_route.py` and `test_section_route.py`

- Prepend the reference block to the user prompt.
- Tests: add a ref via the fixture, generate outline, assert prompt sent to mock LLM includes the reference content.

---

## Section 5 — Ideation

### Task 17: `generate/ideation.py`

**Files:** `packages/api/blogforge/generate/ideation.py`, `packages/api/tests/test_ideation.py`

- Builds full conversation: system (pack-composed + ideation system block) + history + new user message.
- Streams via the provider's `stream_chat` (or wraps `chat` if streaming unavailable).
- On `done`, parses the assistant text for a ```json … ``` block; lenient parser (extra keys allowed). Returns `(message_text, proposed_outline_or_none)`.

### Task 18: POST /api/drafts/{id}/ideation/message

**Files:** `packages/api/blogforge/api/ideation.py`, `packages/api/tests/test_ideation_round_trip.py`

- Persists the user message; creates an `ideation` job; streams the assistant reply via SSE using the existing `JobRegistry` + frame conventions; on done persists the assistant message with parsed `proposed_outline`.
- 409 `ideation_in_progress` if another ideation job is active on this draft.

### Task 19: POST /api/drafts/{id}/ideation/accept

**Files:** same router; tests in `test_ideation_round_trip.py`.

- Find the most recent assistant message with a non-null `proposed_outline`.
- Copy it onto `draft.outline`; set `stage = "outline"`; commit; return the updated `Draft`.

### Task 20: GET /api/drafts/{id}/ideation

**Files:** same router; tests in `test_ideation_round_trip.py`.

Returns the message history (ordered by `position`).

---

## Section 6 — Web UI

### Task 21: API clients — `references` + `ideation`

**Files:** `packages/web/src/api/references.ts`, `packages/web/src/api/ideation.ts`

Typed wrappers over the new endpoints. Mirrors the `adminKeys.ts` pattern.

### Task 22: `useStreamJob` hook

**Files:** `packages/web/src/hooks/useStreamJob.ts`, `packages/web/tests/hooks/useStreamJob.test.tsx`

Generalises `useExpandJob`'s EventSource pattern: takes `{ onDelta, onResult, onError, onDone }`. Section regen + ideation both consume.

### Task 23: `ReferencesList` + `AddReferenceForm`

**Files:** `packages/web/src/components/ReferencesList.tsx`, `packages/web/src/components/AddReferenceForm.tsx`, vitest stubs.

Per spec §"UI components".

### Task 24: `ResearchPanel`

**Files:** `packages/web/src/components/draft/ResearchPanel.tsx`, `packages/web/tests/components/ResearchPanel.test.tsx`

Two-column desktop layout per spec; chat left, outline-preview + ReferencesList right. Accept button enabled when latest assistant message has a `proposed_outline`.

### Task 25: `DraftWorkspace` stage routing

**Files:** `packages/web/src/components/draft/DraftWorkspace.tsx`

`stage === "research"` mounts `ResearchPanel`; outline + sections panels gain an optional `references` prop and render `ReferencesList` collapsible in their right rail.

### Task 26: `DraftsPage` + `StatusPill` + `OutlineSidebar` stage labels

**Files:** find every hardcoded `"idea"` / `"Seed"` literal; update to `"research"` / `"Researching"`.

### Task 27: Remove `IdeaPanel.tsx`

Delete the static-form component; verify nothing imports it.

---

## Section 7 — Stage rename hardening

### Task 28: Find & update hardcoded `"idea"` strings

**Files:** grep across both packages.

`grep -rn '"idea"\|'\''idea'\''' packages/ --include='*.ts*' --include='*.py' | grep -v test_`

Each hit gets reviewed; most are test fixtures (already valid because the migration coerces) but any production-code literal becomes `"research"`.

### Task 29: API-side coercion shim

**Files:** `packages/api/blogforge/api/drafts.py` (PUT handler).

If an incoming `Draft` body has `stage == "idea"`, coerce to `"research"`. Log a deprecation warning. Removable after the next deploy.

---

## Section 8 — Wrap-up

### Task 30: Quality sweep

- `uv run ruff check packages/api` → clean.
- `uv run mypy packages/api` → clean.
- `uv run pytest packages/api/tests -q` → all green.
- `cd packages/web && pnpm exec biome check .` → clean.
- `pnpm exec vitest run` → green.
- `pnpm build` → green.

### Task 31: README + spec status note

- Update README "How it works" — Stage 1 becomes "Research" instead of "Idea".
- Mark v1 spec as `Superseded by 2026-05-28-research-stage-references-v2-design.md` at the top.

### Task 32: Live smoke against docker stack

- `./scripts/start.sh`.
- Log in as admin → create a new draft → add a URL reference → see extraction → send an ideation message → see the streamed reply → Accept → confirm stage flips to outline with the proposed outline populated.
- Note any UX gaps for follow-up commits (out-of-scope items, polish).

### Task 33: PR

Push `research-stage-references` to origin; open PR titled **"Phase B: research stage + references"** with the spec/plan cross-links and a manual-test checklist.

---

## Section ordering rationale

1. **S3 foundation must land first** — references module can't write its outputs without `S3Client`.
2. **Models before routes** — pydantic + ORM + migration before any route depends on them.
3. **References before ideation** — ideation is the user of the reference-context helper; references must exist as a feature first.
4. **Prompt injection before ideation** — gives outline + section the upgrade before the harder LLM-streaming work.
5. **Web in one pass at the end** — the UI cuts across all backend features; doing it earlier creates rework as the API shape settles.
6. **Stage rename last** — the literal hunt is rote but distracting; keep it out of the hot-path commits.

## Watch-outs

- **`SqlDraftStore.get()` becomes a `selectinload(...)` festival.** Eager-load references AND ideation_messages AND sections, all in one round-trip. If we forget, the route handlers will hit lazy loads outside the session and crash.
- **SSE on Safari** has its own quirks; we already worked around them in `useExpandJob` — `useStreamJob` should not regress.
- **Migration on existing prod data.** If anyone's actively using the docker stack with `stage="idea"` drafts when the migration runs, those drafts will silently become `stage="research"`. That's the intended behavior, but the deployment note should mention it.
- **MinIO bucket policy** — we don't bother setting policies; the API is the only client. If someone enables public access on the bucket, that's an ops concern outside this plan.

## Dispatch strategy

Same pattern that worked for Phase A:

- **Section 1 (S3 foundation)** — inline. It's the riskiest piece and benefits from immediate iteration.
- **Section 2 (data model + migration)** — inline. Small.
- **Section 3 (references API)** — dispatch to a subagent. Mostly mechanical CRUD + extraction.
- **Section 4 (prompt injection)** — inline. It's only 2 tasks.
- **Section 5 (ideation)** — inline. Streaming + LLM glue benefits from close eyes.
- **Section 6 (web UI)** — dispatch to a subagent. Same shape as Phase A Section 6.
- **Section 7 (stage rename)** — inline. Small.
- **Section 8 (wrap-up)** — inline.

Adjust as we go; this is a recommendation, not a commitment.
