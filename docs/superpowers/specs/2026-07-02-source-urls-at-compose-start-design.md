# Source URLs at compose-start — design

**Goal:** Let the writer paste one or more **source URLs** when starting a draft from scratch (Express, Propose, Blank modes), so the **first generation pass** (outline → draft, or the ideation chat) is grounded in that URL's real content — ideal for writing about a coding project from its README / release notes / repo page.

**Status:** approved 2026-07-02 (modes = Express/Propose/Blank; multiple URLs; all saved as references; failed fetch is non-fatal).

## Background — what already exists

- **References already ground generation.** `generate/references.get_reference_context(draft_id, refs)` assembles the extracted text of a draft's references, and it is already injected into the ideation chat (`generate/ideation.build_ideation_prompt`), the outline (`generate/outline.propose_outline`), and section/expand prompts. No generation code needs to change.
- **URL → clean text extraction exists.** `references/extractors.extract_url(url)` uses trafilatura (8s fetch timeout, 200k char cap) and returns an `ExtractionResult(name, extracted_markdown, extracted_chars)`.
- **The references router** (`api/references.py`) already ingests a URL: `extract_url` → write `drafts/{id}/references/originals/{ref_id}` + `extracted/{ref_id}.md` blobs → insert a `ReferenceRow` → return a `Reference`.

**The only gap:** references can currently be added *only after* the draft exists (Research stage). Nothing attaches a URL at compose-start, so the first pass never sees it.

## Approach (chosen: backend-bundled)

`create_draft` ingests the URLs **before it returns**, so "the first pass is grounded" is enforced server-side and unit-testable in pytest. The frontend just passes the URLs in the existing create call.

Rejected alternative — *frontend-orchestrated* (call `POST /references/url` N times after `createDraft`, before `outline`): zero backend change, but the ordering contract lives in JS only and adds round-trips.

## Architecture

### Backend

1. **Factor a reusable ingest service.** Extract the URL-ingest body from `api/references.py` into
   `references/ingest.py::ingest_url_reference(session, s3, draft_id, url, name=None) -> Reference`
   (extract → dual blob write → `ReferenceRow` insert). The existing `POST /references/url` endpoint
   calls it too (DRY — behavior unchanged).

2. **`IdeaInput.source_urls`.** Add `source_urls: list[str] = Field(default_factory=list)` to the
   draft-create request model (`api/drafts.py` / `drafts/models.py`), capped at **10** entries
   (extra entries rejected with 422). Also add it to any Pydantic `Literal`/model the create path
   validates against (mirror how `provider` had to be added in multiple models).

3. **Ingest in `create_draft`.** After the draft row is created and flushed (so `draft.id` exists),
   if `source_urls` is non-empty, fetch them **concurrently** via
   `asyncio.gather(*[ingest_url_reference(...) for url in urls], return_exceptions=True)`.
   Attach every success; collect `(url, error)` for every failure. Commit once.

4. **Report partial failure without blowing up the draft.** The create response carries
   `reference_warnings: list[ReferenceWarning]` where `ReferenceWarning = {url: str, error: str}`.
   A dead / paywalled / timed-out URL, or an extraction that yields no readable text, becomes a
   warning — never a 4xx/5xx. The draft is always created.

### Frontend

5. **`SourceUrlsField` component** (`components/compose/SourceUrlsField.tsx`): a labelled, optional
   list of URL inputs with **add / remove** and light `http(s)://` validation. Controlled; value is
   `string[]`; blank rows are dropped on submit.

6. **Wire into the three panels.** Render `SourceUrlsField` in `ExpressPanel`, `ProposePanel`, and
   `BlankPanel` beneath the topic field. `ComposeStudio.ideaFrom()` threads the URLs into the
   `IdeaInput` sent to `createDraft`. Express/Propose then run outline/expand as they do now (now
   grounded); Blank lands in Research with the references already attached.

7. **Surface warnings.** If `createDraft` returns `reference_warnings`, show a non-blocking toast:
   "N of M sources couldn't be fetched" (list the URLs). The draft still opens.

### Data flow (Express)

```
SourceUrlsField → ideaFrom() → POST /api/drafts { …, source_urls:[u1,u2] }
   └ create_draft: insert draft → gather(ingest_url_reference ×N) → commit
        → response { draft, reference_warnings:[…] }
→ POST /drafts/{id}/outline   (get_reference_context sees the new refs → grounded)
→ POST /drafts/{id}/expand    (grounded)
```

For **Blank**, the flow stops after create: the draft opens in Research with the refs listed.

## Error handling

- Individual URL failure → non-fatal warning; other URLs and the draft proceed.
- Empty extraction (no readable body) is treated as a failed fetch (warning).
- `> 10` URLs → 422 (validation), before any fetch.
- No `source_urls` → behaviour identical to today (empty list default).

## "Product release" note

There is no "product release" compose *mode*; it's a pack **format** the user selects. This feature
is orthogonal — the URL field appears on Express/Propose/Blank regardless of the chosen format, so
product-release posts get it.

## Testing

**Backend (pytest, mock `extract_url` — no network):**
- `create_draft` with `source_urls` inserts a `ReferenceRow` per URL and attaches them to the draft.
- A URL whose extraction raises is **non-fatal**: the draft is still created and the failure appears
  in `reference_warnings`.
- After creation, `get_reference_context(draft.id, …)` includes the attached text → proves the first
  outline is grounded (the injection path is already covered; this asserts the wiring end-to-end).
- `> 10` URLs → 422.
- `POST /references/url` still works (regression on the factored helper).

**Frontend (vitest):**
- `SourceUrlsField`: add row, remove row, drop blank rows, reject non-`http(s)` input.
- `ComposeStudio` passes `source_urls` through to `createDraft` (mocked api).

## Out of scope

- No new "product release" mode/format.
- No change to any generation prompt (grounding reuses the existing reference-context injection).
- File/note sources at compose-start (URL only for now; files/notes remain a Research-stage action).
