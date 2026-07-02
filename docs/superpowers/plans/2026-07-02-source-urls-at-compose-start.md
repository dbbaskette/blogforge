# Source URLs at compose-start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the writer paste source URLs when starting an Express/Propose/Blank draft, so the first generation pass is grounded in the URLs' fetched content.

**Architecture:** `create_draft` ingests `source_urls` as normal references (reusing the existing trafilatura extractor + `_persist`) *before returning*, so the already-existing reference-context injection (outline/expand/ideation) grounds the first pass with zero generation-path changes. Frontend adds a small multi-URL field to three panels.

**Tech Stack:** FastAPI + pydantic + SQLAlchemy (backend), React + TS + vitest (frontend).

Spec: `docs/superpowers/specs/2026-07-02-source-urls-at-compose-start-design.md`.

---

## File structure

- `packages/api/blogforge/api/references.py` — add `ingest_url_reference()` (factored from `add_url_reference`, reuses `_persist`); refactor the endpoint to call it.
- `packages/api/blogforge/drafts/models.py` — `IdeaInput.source_urls`, new `ReferenceWarning`, `Draft.reference_warnings`.
- `packages/api/blogforge/api/drafts.py` — `create_draft` ingests URLs concurrently, re-fetches, attaches warnings.
- `packages/api/tests/api/test_source_urls_compose.py` — new backend tests.
- `packages/web/src/api/drafts.ts` — `IdeaInput.source_urls`, `Draft.reference_warnings`.
- `packages/web/src/components/compose/SourceUrlsField.tsx` — new field.
- `packages/web/src/components/compose/{ExpressPanel,ProposePanel,BlankPanel}.tsx` — render the field.
- `packages/web/src/components/compose/ComposeStudio.tsx` — hold `sourceUrls` state, thread into `ideaFrom`, toast on warnings.
- `packages/web/src/components/compose/SourceUrlsField.test.tsx` — new frontend test.

---

## Task 1: Factor `ingest_url_reference` (backend, DRY)

**Files:** Modify `packages/api/blogforge/api/references.py`

- [ ] **Step 1:** Add a module-level helper above `add_url_reference` that wraps extract + persist:

```python
async def ingest_url_reference(
    draft_id_str: str, draft_uuid: UUID, url: str, name: str | None = None
) -> Reference:
    """Fetch a URL, extract clean text, and persist it as a 'url' reference.
    Raises ValueError on fetch/extract failure (as extract_url does)."""
    extraction = await extract_url(url)
    if name:
        extraction = ExtractionResult(
            name=name, extracted=extraction.extracted, extracted_chars=extraction.extracted_chars
        )
    return await _persist(
        draft_id_str=draft_id_str,
        draft_uuid=draft_uuid,
        kind="url",
        extraction=extraction,
        original_bytes=url.encode("utf-8"),
        original_ext=file_extension_for_kind("url"),
        url=url,
    )
```

- [ ] **Step 2:** Refactor `add_url_reference` to delegate:

```python
async def add_url_reference(draft_id, body, request, current=Depends(get_current_user)) -> Reference:
    draft_uuid = await _resolve_draft(request, draft_id, current)
    try:
        return await ingest_url_reference(draft_id, draft_uuid, body.url, body.name or None)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": {"code": "url_fetch_failed", "message": str(err)}},
        ) from err
```

- [ ] **Step 3:** Run existing reference tests: `pytest tests/api/test_references*.py -q` → PASS (behavior unchanged).
- [ ] **Step 4:** Commit `refactor(references): factor ingest_url_reference from the url endpoint`.

## Task 2: Models — `source_urls`, `ReferenceWarning`, `reference_warnings`

**Files:** Modify `packages/api/blogforge/drafts/models.py`

- [ ] **Step 1:** Add to `IdeaInput` (after `bullets`):

```python
    # URLs pasted at compose-start; create_draft fetches each as a reference so
    # the first outline/draft is grounded in real source material. Capped at 10.
    source_urls: list[str] = Field(default_factory=list, max_length=10)
```

- [ ] **Step 2:** Add a warning model + field on `Draft`:

```python
class ReferenceWarning(BaseModel):
    """A source URL that couldn't be fetched at compose-start (non-fatal)."""
    url: str
    error: str
```
```python
    # Transient: only create_draft populates this (a URL that failed to fetch).
    # Empty on every other Draft response.
    reference_warnings: list[ReferenceWarning] = Field(default_factory=list)
```

- [ ] **Step 3:** Sanity import: `python -c "from blogforge.drafts.models import IdeaInput, Draft, ReferenceWarning"` → no error.
- [ ] **Step 4:** Commit `feat(drafts): IdeaInput.source_urls + Draft.reference_warnings`.

## Task 3: `create_draft` ingests URLs (backend, TDD)

**Files:** Modify `packages/api/blogforge/api/drafts.py`; Create `packages/api/tests/api/test_source_urls_compose.py`

- [ ] **Step 1 (failing test):** `test_source_urls_compose.py` — use FsStorage in a tmp dir (no network), monkeypatch `extract_url`:

```python
import pytest
from blogforge.references.extractors import ExtractionResult


@pytest.fixture
def fs_storage(tmp_path, monkeypatch):
    from blogforge.config import get_settings
    from blogforge.s3.client import reset_s3_client_for_tests
    monkeypatch.setenv("BLOGFORGE_STORAGE_BACKEND", "fs")
    monkeypatch.setenv("BLOGFORGE_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear(); reset_s3_client_for_tests()
    yield
    get_settings.cache_clear(); reset_s3_client_for_tests()


def _idea(**over):
    base = dict(topic="My CLI tool", provider="anthropic", model="x", use_voice_profile=True, pack_slug="")
    base.update(over)
    return base


async def test_create_draft_ingests_source_urls(client, auth_headers, fs_storage, monkeypatch):
    async def fake_extract(url):
        return ExtractionResult(name=f"T:{url}", extracted=f"# body {url}", extracted_chars=10)
    monkeypatch.setattr("blogforge.api.references.extract_url", fake_extract)

    r = await client.post("/api/drafts", headers=auth_headers,
                          json=_idea(source_urls=["https://a.example", "https://b.example"]))
    assert r.status_code == 201
    body = r.json()
    urls = sorted(ref["url"] for ref in body["references"] if ref["kind"] == "url")
    assert urls == ["https://a.example", "https://b.example"]
    assert body["reference_warnings"] == []


async def test_failed_url_is_nonfatal_and_warns(client, auth_headers, fs_storage, monkeypatch):
    async def fake_extract(url):
        if "bad" in url:
            raise ValueError("could not fetch")
        return ExtractionResult(name="ok", extracted="# ok", extracted_chars=4)
    monkeypatch.setattr("blogforge.api.references.extract_url", fake_extract)

    r = await client.post("/api/drafts", headers=auth_headers,
                          json=_idea(source_urls=["https://ok.example", "https://bad.example"]))
    assert r.status_code == 201
    body = r.json()
    assert [ref["url"] for ref in body["references"] if ref["kind"] == "url"] == ["https://ok.example"]
    assert [w["url"] for w in body["reference_warnings"]] == ["https://bad.example"]


async def test_too_many_urls_422(client, auth_headers):
    r = await client.post("/api/drafts", headers=auth_headers,
                          json=_idea(source_urls=[f"https://x{i}.example" for i in range(11)]))
    assert r.status_code == 422
```

> NOTE: match `client`/`auth_headers` fixtures to whatever `tests/api/test_drafts_route.py` uses; copy its import/setup boilerplate.

- [ ] **Step 2:** Run → FAIL (create_draft ignores source_urls; no `reference_warnings` key).
- [ ] **Step 3:** Implement in `create_draft`:

```python
import asyncio
from uuid import UUID
from blogforge.drafts.models import ReferenceWarning

@router.post("", response_model=Draft, status_code=status.HTTP_201_CREATED)
async def create_draft(idea, request, current=Depends(get_current_user)) -> Draft:
    store = _store(request)
    draft = await store.create(user_id=current.id, idea=idea)
    warnings: list[ReferenceWarning] = []
    if idea.source_urls:
        from blogforge.api.references import ingest_url_reference
        draft_uuid = UUID(draft.id)
        results = await asyncio.gather(
            *[ingest_url_reference(draft.id, draft_uuid, u) for u in idea.source_urls],
            return_exceptions=True,
        )
        warnings = [
            ReferenceWarning(url=u, error=str(r) or r.__class__.__name__)
            for u, r in zip(idea.source_urls, results) if isinstance(r, Exception)
        ]
        refreshed = await store.get(draft.id, user_id=current.id)
        if refreshed is not None:
            draft = refreshed
    draft.reference_warnings = warnings
    await request.app.state.event_bus.emit(
        {"type": "draft:created", "id": draft.id, "title": draft.title}
    )
    return draft
```

- [ ] **Step 4:** Run new tests → PASS. Then `pytest tests/api/test_drafts_route.py -q` → PASS (no regression).
- [ ] **Step 5:** Commit `feat(drafts): create_draft fetches source_urls as grounding references`.

## Task 4: Frontend types

**Files:** Modify `packages/web/src/api/drafts.ts`

- [ ] **Step 1:** `IdeaInput` gains `source_urls?: string[];`. Add `export interface ReferenceWarning { url: string; error: string; }` and `Draft` gains `reference_warnings?: ReferenceWarning[];`.
- [ ] **Step 2:** `pnpm -C packages/web tsc --noEmit` (or the repo's typecheck) → clean.
- [ ] **Step 3:** Commit `feat(web): source_urls + reference_warnings types`.

## Task 5: `SourceUrlsField` component (frontend, TDD)

**Files:** Create `SourceUrlsField.tsx` + `SourceUrlsField.test.tsx` under `packages/web/src/components/compose/`

- [ ] **Step 1 (failing test):** render with value `[]`, type a URL, assert `onChange` called with `["https://x"]`; add-row then remove-row; a non-`http(s)` value shows an invalid hint and is dropped from the emitted value.
- [ ] **Step 2:** Run → FAIL (no component).
- [ ] **Step 3:** Implement a controlled component: props `{ value: string[]; onChange: (v: string[]) => void }`. Render one input per entry plus a trailing blank; "+ Add source" appends; each row has a remove ✕. Light validation: a row is "invalid" if non-empty and not `/^https?:\/\//i`. Emit only non-blank rows; keep blanks in local UI state only. Match existing compose input styling (`nb-input`, labels from `SetupFields`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): SourceUrlsField multi-URL compose input`.

## Task 6: Wire into panels + ComposeStudio + warning toast

**Files:** Modify `ExpressPanel.tsx`, `ProposePanel.tsx`, `BlankPanel.tsx`, `ComposeStudio.tsx`

- [ ] **Step 1:** In `ComposeStudio`, add `const [sourceUrls, setSourceUrls] = useState<string[]>([]);`. Update `ideaFrom` to accept + include it:

```ts
function ideaFrom(settings, topic, bullets, notes, sourceUrls: string[] = []): IdeaInput {
  return { topic, bullets, notes, source_urls: sourceUrls, ...settings };
}
```

Pass `sourceUrls` into the **blank / express / propose** `createDraft` calls (lines ~127, ~194, ~220 — confirm which is which); leave the **outline/paste** call unchanged (no field there).

- [ ] **Step 2:** After each of those `createDraft` results, if `draft.reference_warnings?.length`, toast (reuse the app's toast util): `"Couldn't fetch ${n} of ${sent} source(s): ${urls.join(', ')}"`. Draft still opens.
- [ ] **Step 3:** Pass `value={sourceUrls} onChange={setSourceUrls}` and render `<SourceUrlsField>` inside `ExpressPanel`, `ProposePanel`, `BlankPanel` (thread the two props through each panel's props).
- [ ] **Step 4:** Typecheck + `pnpm -C packages/web test` → PASS.
- [ ] **Step 5:** Commit `feat(web): source URL field in Express/Propose/Blank + warning toast`.

## Task 7: Full verification

- [ ] Backend: `pytest tests/ -q --ignore=tests/api/test_linkedin_import_endpoint.py` → green.
- [ ] Frontend: typecheck + `pnpm test` + `pnpm build` → green.
- [ ] Commit any lint fixups.

---

## Self-review

- **Spec coverage:** modes (T6 — Express/Propose/Blank) ✓; multiple URLs (T2 list + T5 field) ✓; saved as references (T3 ingest) ✓; non-fatal fetch (T3 warnings) ✓; grounded first pass (T3 ingest-before-return; injection unchanged) ✓; product-release orthogonal (no mode) ✓; tests (T3/T5) ✓.
- **Types:** `source_urls: list[str]` / `source_urls?: string[]`, `ReferenceWarning{url,error}` / `reference_warnings`, `ingest_url_reference(draft_id_str, draft_uuid, url, name)` consistent across tasks.
- **Placeholders:** the only deferred detail is matching the existing `client/auth_headers` test fixtures + exact ComposeStudio call-site line numbers — both explicitly flagged to confirm against current files, not invented.
