# GEO Enhancements Implementation Plan (all 10 → 5 PRs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement
> task-by-task. Steps use checkbox (`- [ ]`) syntax. One PR per phase; run the full backend suite
> (`pytest tests/ -q --ignore=tests/api/test_linkedin_import_endpoint.py`) and frontend
> (`npx vitest run` + `npx tsc --noEmit`) before each merge. Branch each phase from `origin/main`;
> commit with explicit `git add <files>` (the working tree may hold unrelated WIP).

**Goal:** implement the approved GEO spec (`docs/superpowers/specs/2026-07-02-geo-enhancements-design.md`):
citations lever + reference-grounded link/quote fixes, takeaways lever, freshness lever, four
augments, JSON-LD description gap-fill, target-query export. Weights rebalance to 12 levers with
present-weight normalization. Enhancement #5 (JSON-LD export) is already shipped — no phase for it.

**Architecture:** everything extends `packages/api/blogforge/generate/geo.py`'s existing patterns:
structural levers in `score_structural`, semantic levers in the single `_run_semantic` LLM pass
(schema `_SEMANTIC_SCHEMA` geo.py:439, directive geo.py:497, parser `parse_semantic` geo.py:541),
fixes as small endpoints in `packages/api/blogforge/api/geo.py`, panel plumbing in
`packages/web/src/components/draft/GeoPanel.tsx`. Honesty rules: no invented facts/dates/sources;
quotes verbatim-validated server-side.

**Tech stack:** FastAPI + pydantic, one temperature-0 LLM pass, React/TS, pytest + vitest.

---

# PHASE GEO-1 — weights rebalance + citations lever + reference-grounded fixes

**Branch:** `feat/geo-citations` · **Files:**
- Modify: `packages/api/blogforge/generate/geo.py` (weights/order/labels ~29-62, schema ~439,
  directive ~497, `parse_semantic` ~541, `build_report` ~656, `_SEMANTIC_KEYS` ~669,
  `_run_semantic` JSON example ~685)
- Modify: `packages/api/blogforge/api/geo.py` (2 new endpoints)
- Modify: `packages/web/src/components/draft/GeoPanel.tsx` (+ `packages/web/src/api/geo.ts`)
- Test: `packages/api/tests/generate/test_geo.py`, `packages/web/tests/components/geoTotalScore.test.ts`

### Task 1: 12-key weights + normalized total (TDD)

- [ ] **Step 1 — failing test** (append to `tests/generate/test_geo.py`; reuse its `_draft`/`_sec` helpers):

```python
def test_build_report_normalizes_by_present_weights() -> None:
    # Only two levers present: total must be their weighted mean, not diluted
    # by absent levers' weights.
    levers = {
        "answer_first": {"key": "answer_first", "score": 100, "weight": 0.16,
                         "label": "x", "detail": "", "findings": [], "fix": None},
        "faq": {"key": "faq", "score": 50, "weight": 0.06,
                "label": "x", "detail": "", "findings": [], "fix": None},
    }
    report = build_report(levers)
    # (100*.16 + 50*.06) / (.16+.06) = 86.36 → 86
    assert report["score"] == 86
```

- [ ] **Step 2:** run `pytest tests/generate/test_geo.py::test_build_report_normalizes_by_present_weights -q` → FAIL (old formula gives 19).
- [ ] **Step 3 — implement.** Replace `_WEIGHTS` (geo.py:29) with the 12-key table from the spec
  (answer_first .16, factual_density .16, citations .10, definitional_opener .08,
  question_headings .08, skimmability .08, brand_explicit .06, faq .06, chunking .06,
  takeaways .06, freshness .06, comparison_table .04). Append `"citations"`, `"takeaways"`,
  `"freshness"` to `_ORDER` (citations after factual_density; takeaways after definitional_opener;
  freshness after skimmability) and `_LABELS`
  (`"citations": "Cited sources"`, `"takeaways": "Key-takeaways block"`,
  `"freshness": "Freshness signals"`). Replace `build_report`'s total:

```python
    present = [(k, w) for k, w in _WEIGHTS.items() if k in levers]
    wsum = sum(w for _, w in present) or 1.0
    score = round(sum(levers[k]["score"] * w for k, w in present) / wsum)
```

- [ ] **Step 4:** run the file's suite: `pytest tests/generate/test_geo.py -q` → PASS (existing
  total-score tests may assert old weights — update any that hardcode weight values to the new table).
- [ ] **Step 5 — frontend mirror.** In `GeoPanel.tsx` update `LEVER_WEIGHTS` (lines 53-63) to the
  same 12 keys, and make `computeTotalScore` divide by the sum of weights of the levers actually
  present in the report (same normalization). Update
  `packages/web/tests/components/geoTotalScore.test.ts` expectations accordingly.
- [ ] **Step 6:** `npx vitest run tests/components/geoTotalScore.test.ts` → PASS. Commit:
  `feat(geo): 12-lever weight table + present-weight-normalized totals`.

### Task 2: citations semantic lever (TDD)

- [ ] **Step 1 — failing tests:**

```python
def test_parse_semantic_citations_lever_and_findings() -> None:
    s = _sec("Claims", "Our latency dropped 40% last quarter.")
    d = _draft([s])
    raw = (
        '{"answer_first": {"score": 80, "note": "ok"},'
        '"definitional_opener": {"score": 80, "note": "ok", "has_definition": true},'
        '"factual_density": {"score": 80, "note": "ok"},'
        '"brand_explicit": {"score": 80, "note": "ok"},'
        '"citations": {"score": 45, "note": "claims lack sources", "uncited_claims": ['
        '{"target": "Our latency dropped 40% last quarter.", "note": "no source linked"}]}}'
    )
    levers = parse_semantic(raw, d)
    cit = levers["citations"]
    assert cit["score"] == 45
    assert cit["findings"][0]["target"] == "Our latency dropped 40% last quarter."
    assert cit["findings"][0]["fix"] == "cite_reference"


def test_augment_citations_caps_score_when_no_outbound_links() -> None:
    d = _draft([_sec("Body", "No links here at all.")])
    lever = {"key": "citations", "score": 90, "weight": 0.1, "label": "x",
             "detail": "", "findings": [], "fix": None}
    augment_citations({"citations": lever}, d)
    assert lever["score"] == 40
    d2 = _draft([_sec("Body", "See [the docs](https://example.com/docs).")])
    lever2 = {"key": "citations", "score": 90, "weight": 0.1, "label": "x",
              "detail": "", "findings": [], "fix": None}
    augment_citations({"citations": lever2}, d2)
    assert lever2["score"] == 90
```

- [ ] **Step 2:** run → FAIL (no citations key, no `augment_citations`).
- [ ] **Step 3 — implement** in `geo.py`:
  - Regex near the other patterns: `_OUTLINK_RE = re.compile(r"\[[^\]]+\]\(https?://[^)]+\)")`.
  - Schema: add to `_SEMANTIC_SCHEMA["properties"]`:

```python
        "citations": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "note": {"type": "string"},
                "uncited_claims": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"target": {"type": "string"}, "note": {"type": "string"}},
                        "required": ["target"],
                    },
                },
            },
            "required": ["score", "note"],
        },
```

    and append `"citations"` to the schema's `required` list.
  - Directive: append item 5 to `_SEMANTIC_DIRECTIVE`:

```python
    "5) citations: do concrete, checkable claims carry a source — a named origin "
    "or an outbound link? Score how well claims are attributed. In `uncited_claims` "
    "quote up to 3 passages that assert something checkable with no source; in each "
    "`note` say what kind of source would back it. Never invent sources."
```

  - `_run_semantic` inline JSON example (geo.py:685-691): add
    `'"citations": {"score": 0, "note": "", "uncited_claims": []}'` to the example object.
  - `parse_semantic`: after the `brand` block, build the lever (findings get
    `fix: "cite_reference"`; lever `fix` is `"cite_reference"` when findings exist) and add
    `"citations": citations_lever` to the returned dict:

```python
    cit = data.get("citations") if isinstance(data.get("citations"), dict) else {}
    claims = cit.get("uncited_claims") if isinstance(cit.get("uncited_claims"), list) else []
    cit_findings = [
        {
            "target": str(c.get("target", "")).strip(),
            "note": str(c.get("note", "")).strip() or "This claim has no source.",
            "fix": "cite_reference",
        }
        for c in claims
        if isinstance(c, dict) and str(c.get("target", "")).strip()
    ][:3]
    citations = _lever(
        "citations",
        _quant5(cit.get("score")),
        str(cit.get("note", "")).strip()
        or "Whether concrete claims link to or name their sources.",
        findings=cit_findings,
        fix="cite_reference" if cit_findings else None,
    )
```

  - `augment_citations` (near `augment_factual_density`), called from `_run_semantic` after the
    other augments:

```python
def augment_citations(semantic: dict[str, dict[str, Any]], draft: Draft) -> None:
    """No outbound links anywhere → cap the citations score at 40. The semantic
    judge can be charitable about named-but-unlinked sources; a zero-link draft
    is never well-cited."""
    lever = semantic.get("citations")
    if lever is None:
        return
    text = _draft_text(draft)
    if not _OUTLINK_RE.search(text) and lever["score"] > 40:
        lever["score"] = 40
        lever["detail"] = (lever["detail"] + " No outbound source links anywhere.").strip()
```

  - Add `"citations"` to `_SEMANTIC_KEYS` (geo.py:669).
- [ ] **Step 4:** run both tests → PASS; then full `pytest tests/generate/test_geo.py -q` → PASS.
- [ ] **Step 5:** commit `feat(geo): citations lever — semantic scoring + zero-link cap`.

### Task 3: `/geo/quotes` (verbatim candidates) + `/geo/cite` (weave) endpoints (TDD)

- [ ] **Step 1 — failing endpoint test** (new `packages/api/tests/api/test_geo_citations.py`;
  copy the client/auth/mock-provider setup from the existing GEO endpoint tests — grep
  `tests/api/` for the file exercising `/geo/faq` and mirror it, with
  `BLOGFORGE_TEST_PROVIDER=mock` or a monkeypatched provider):

```python
async def test_quotes_rejects_non_verbatim_candidates(...):
    # Arrange: draft + one reference whose extracted markdown is KNOWN text
    # (write it via the fs storage fixture at drafts/{id}/references/extracted/{ref_id}.md).
    # Mock the LLM to return one verbatim quote and one fabricated quote.
    # Act: POST /api/drafts/{id}/geo/quotes {"reference_id": ref_id}
    # Assert: 200; response quotes == [the verbatim one]; fabricated one filtered out.

async def test_cite_returns_rewritten_passage(...):
    # Mock LLM to return a rewritten passage; POST /api/drafts/{id}/geo/cite
    # {"section_id": sid, "target": "Our latency dropped 40%.", "reference_id": ref_id}
    # Assert: 200 and {"passage": "<mock text>"}; and that the prompt sent to the
    # provider contained the reference name and url (assert on the mock's captured prompt).
```

- [ ] **Step 2:** run → FAIL (404 route).
- [ ] **Step 3 — implement** in `api/geo.py`, following the `/geo/table` endpoint's shape
  (draft scoping, provider resolution, error mapping):

```python
class _QuotesBody(BaseModel):
    reference_id: str

@router.post("/api/drafts/{draft_id}/geo/quotes")
async def geo_quotes(draft_id: str, body: _QuotesBody, request: Request,
                     current: User = Depends(get_current_user)) -> dict[str, list[str]]:
    """2-3 VERBATIM quote candidates from one attached reference. Non-verbatim
    model output is filtered server-side — the honesty guard."""
    draft = ...  # existing scoped-load helper in this file
    ref = next((r for r in draft.references if r.id == body.reference_id), None)
    if ref is None:
        raise HTTPException(404, detail={"error": {"code": "reference_not_found", "message": body.reference_id}})
    from blogforge.s3 import get_s3_client
    extracted = (await get_s3_client().get_object(
        f"drafts/{draft_id}/references/extracted/{ref.id}.md")).decode("utf-8")
    prompt = (
        "From the source text below, select 2-3 short passages (one or two sentences "
        "each, under 60 words) that would make strong supporting quotes for an article. "
        "Copy them EXACTLY, character for character — do not paraphrase, trim words, or "
        'fix punctuation. Return JSON: {"quotes": ["..."]}.\n\nSOURCE:\n' + extracted[:20000]
    )
    resp = await provider.complete(model=model, prompt=prompt,
                                   json_schema={"type": "object", "properties": {
                                       "quotes": {"type": "array", "items": {"type": "string"}}},
                                       "required": ["quotes"]},
                                   temperature=0.0)
    raw = json.loads(resp.text).get("quotes", [])
    verbatim = [q.strip() for q in raw if isinstance(q, str) and q.strip() and q.strip() in extracted]
    return {"quotes": verbatim[:3]}
```

```python
class _CiteBody(BaseModel):
    section_id: str
    target: str = Field(min_length=1)
    reference_id: str
    quote: str | None = None  # set by the quote_reference flow

@router.post("/api/drafts/{draft_id}/geo/cite")
async def geo_cite(draft_id: str, body: _CiteBody, request: Request,
                   current: User = Depends(get_current_user)) -> dict[str, str]:
    """Rewrite one passage to attribute (and link) an attached reference — the
    cite_reference / quote_reference fix. Frontend splices the result over `target`."""
    # scoped-load draft; locate section by id (404 if absent); ref like above.
    link = f" ({ref.url})" if ref.url else ""
    quote_clause = (
        f' Weave in this VERBATIM quote from the source, in quotation marks: "{body.quote}".'
        if body.quote else ""
    )
    prompt = (
        "Rewrite the passage below so it attributes its claim to the named source, "
        f'in the author\'s voice: source name "{ref.name}"'
        + (f", linked as a markdown link to {ref.url}" if ref.url else "")
        + "." + quote_clause +
        " Do not change the passage's meaning and do not invent anything beyond the "
        "attribution. Return only the rewritten passage.\n\nPASSAGE:\n" + body.target
    )
    resp = await provider.complete(model=model, prompt=prompt, temperature=None)
    return {"passage": resp.text.strip()}
```

  (Resolve `provider`/`model` exactly the way the existing `/geo/faq` endpoint in this file does.)
- [ ] **Step 4:** run new tests → PASS. Commit
  `feat(geo): /geo/quotes verbatim candidates + /geo/cite attribution weave`.

### Task 4: GeoPanel plumbing for citations fixes

- [ ] **Step 1:** `packages/web/src/api/geo.ts`: add `geoQuotes(draftId, referenceId)` and
  `geoCite(draftId, {section_id, target, reference_id, quote?})` wrappers (mirror the existing
  `geoTable`/`geoFaq` functions).
- [ ] **Step 2:** `GeoPanel.tsx`: for findings with `fix === "cite_reference"`, render a small
  reference picker (draft references are already available in the workspace — thread
  `draft.references` into GeoPanel's props from its parent alongside the existing draft prop) with
  two actions: **Cite** (calls `geoCite`, splices `passage` over the finding's `target` in that
  section via the existing target-splice used by the `bullets` fix, snapshots undo, queues
  `queueRescore("citations")`) and **Quote…** (calls `geoQuotes`, shows the 2-3 candidates, then
  `geoCite` with the chosen `quote`). Empty-reference drafts show "Attach a reference first"
  (link to the Research stage).
- [ ] **Step 3:** add citations entries to the panel's fix-label maps (grep `question_heading` in
  GeoPanel.tsx and extend each map: label "Cite a source", applied-label "Source cited").
- [ ] **Step 4:** `npx tsc --noEmit` + `npx vitest run` → green. Commit
  `feat(web): citations lever UI — reference picker, cite & quote flows`.

### Task 5: phase verification

- [ ] Full backend suite + full frontend suite green; `ruff format --check`/`ruff check` clean on
  touched files. Push, open PR `feat(geo): citations lever + reference-grounded cite/quote fixes`.

---

# PHASE GEO-2 — key-takeaways lever + additive fix

**Branch:** `feat/geo-takeaways` · **Files:** `generate/geo.py` (score_structural + regexes +
`_STRUCTURAL_KEYS`), `api/geo.py` (endpoint), `GeoPanel.tsx` (+ additions tracking), tests.

### Task 1: detection + scoring (TDD)

- [ ] **Step 1 — failing tests:**

```python
def test_takeaways_detected_by_heading_or_bold_block() -> None:
    d = _draft([_sec("Intro", "### Key takeaways\n\n- a\n- b")])
    assert score_structural(d)["takeaways"]["score"] == 100
    d2 = _draft([_sec("Intro", "**Key takeaways**\n\n- a\n- b")])
    assert score_structural(d2)["takeaways"]["score"] == 100

def test_takeaways_absent_offers_fix() -> None:
    lever = score_structural(_draft([_sec("Intro", "Just prose.")]))["takeaways"]
    assert lever["score"] == 45 and lever["fix"] == "takeaways"
```

- [ ] **Step 2:** run → FAIL (KeyError).
- [ ] **Step 3 — implement** in `geo.py`: regexes near the FAQ ones —

```python
_TAKEAWAYS_RE = re.compile(
    r"(?im)^(?:#{2,4}\s*|\*\*)(key takeaways?|tl;?dr|at a glance|in short)\b"
)
```

  and in `score_structural` (searching `outline.opening_hook` + every section's `content_md`):
  present → `_lever("takeaways", 100, "Has a key-takeaways block.")`; absent →
  `_lever("takeaways", 45, "No TL;DR/key-takeaways block — the most-lifted extraction target near the top.", fix="takeaways")`.
  Add `"takeaways"` to `_STRUCTURAL_KEYS`.
- [ ] **Step 4:** tests PASS; commit `feat(geo): key-takeaways lever (structural)`.

### Task 2: `/geo/takeaways` endpoint + panel additive fix

- [ ] **Step 1 — endpoint** (mirror `/geo/faq`'s generation + validation shape; JSON schema
  `{"takeaways": [str]}`, 3-5 items):

```python
prompt = (
    "Write 3-5 key takeaways for this post — one line each, concrete, each standing "
    "alone (a reader who sees ONLY the bullet learns something true from this post). "
    "Ground every bullet strictly in the draft; invent nothing. Stay in the author's "
    'voice; banished words never appear. Return JSON: {"takeaways": ["..."]}.'
)
```

  Endpoint test: mocked provider returns 4 bullets → 200 `{takeaways: [...]}`; empty/garbage model
  reply → 502 using this file's existing error convention.
- [ ] **Step 2 — panel:** on apply, append to the draft's opening
  (`outline.opening_hook + "\n\n**Key takeaways**\n\n- " + bullets.join("\n- ")`) via the same
  updateDraft path the opener fix uses; track in the localStorage additions object as
  `additions.takeaways = {text}` (extend the existing shape + `carveProtectedAdditions` in
  GeoPanel.tsx:186-208 so section/intro rewrites strip and re-attach it verbatim); Remove button +
  undo snapshot + `queueRescore("takeaways")`. Extend the panel tests that cover additions carving
  (`packages/web/tests/components/GeoPanel.test.ts`) with a takeaways case.
- [ ] **Step 3:** suites green; commit; PR `feat(geo): key-takeaways lever + grounded TL;DR fix`.

---

# PHASE GEO-3 — freshness lever + JSON-LD description gap

**Branch:** `feat/geo-freshness` · **Files:** `generate/geo.py`, `export/render.py`, tests.

### Task 1: freshness scoring (TDD)

- [ ] **Step 1 — failing tests:**

```python
def test_freshness_full_when_intro_dated_and_two_mentions() -> None:
    d = _draft([_sec("Intro", "As of March 2026, X holds."), _sec("More", "In 2026-05 we measured Y.")])
    assert score_structural(d)["freshness"]["score"] == 100

def test_freshness_partial_and_absent() -> None:
    d = _draft([_sec("Intro", "No dates."), _sec("More", "We measured in January 2026.")])
    assert score_structural(d)["freshness"]["score"] == 70
    d2 = _draft([_sec("Intro", "No dates anywhere.")])
    lever = score_structural(d2)["freshness"]
    assert lever["score"] == 40 and lever["fix"] is None  # flag-only: we never invent dates
```

- [ ] **Step 2:** FAIL → **Step 3 — implement** (regexes near the others):

```python
_MONTHS = ("january|february|march|april|may|june|july|august|september|october|november|december")
_DATED_RE = re.compile(rf"(?i)\b(?:{_MONTHS})\.?\s+20\d\d\b|\b20\d\d-[01]\d\b")
_ASOF_RE = re.compile(r"(?i)\bas of\b|\bupdated:?\b")
```

  Scoring in `score_structural`: `mentions` = count of `_DATED_RE` matches across opening+sections;
  `intro_dated` = `_DATED_RE` or `_ASOF_RE` hits the opening (or first section when no opening).
  `intro_dated and mentions >= 2` → 100; `mentions >= 1` → 70 with finding
  `{"note": "Only one dated mention — stamp key claims with real dates ('as of March 2026')."}`;
  else → 40, detail
  `"No dated evidence — engines favor content that shows when its facts were true. Add real 'as of' dates via inline edit."`.
  Findings are advisory (`fix` stays `None` — dates are the writer's, never generated). Add
  `"freshness"` to `_STRUCTURAL_KEYS`.
- [ ] **Step 4:** PASS; commit `feat(geo): freshness lever (dated-evidence, flag-only)`.

### Task 2: Article JSON-LD `description`

- [ ] **Step 1 — failing test** (append to the export tests — grep `tests/` for the file covering
  `json_ld`; create `tests/export/test_render_jsonld.py` mirroring `_draft` fixtures if none):

```python
def test_json_ld_includes_description_from_opening() -> None:
    d = _draft([_sec("Intro", "body")])
    d.outline = OutlineProposal(opening_hook="BlogForge is a workshop for long-form writing. More.")
    out = json_ld(d)
    assert '"description": "BlogForge is a workshop for long-form writing.' in out
```

- [ ] **Step 2 — implement** in `export/render.py::json_ld` after the headline line:

```python
    if draft.outline and draft.outline.opening_hook.strip():
        article["description"] = " ".join(draft.outline.opening_hook.split())[:160]
```

- [ ] **Step 3:** PASS; suites green; commit; PR `feat(geo): freshness lever + Article description in JSON-LD`.

---

# PHASE GEO-4 — four augments (experience, alt-text, chunk band, sub-questions)

**Branch:** `feat/geo-augments` · **Files:** `generate/geo.py`, `api/geo.py` (FAQ endpoint param +
alt endpoint), `GeoPanel.tsx`, tests.

### Task 1: first-hand experience → factual_density (semantic, advisory)

- [ ] Schema: add `"first_hand": {"type": "boolean"}` to `factual_density` properties; directive
  item 3 gains: `"Also set first_hand: does the author show first-hand experience — 'we tested',
  'I built', a measured result of their own? First-hand experience raises citation weight."`;
  `_run_semantic`'s inline JSON example gains `"first_hand": false`.
- [ ] `parse_semantic` factual block: when `fd.get("first_hand") is False`, append advisory finding
  `{"target": "", "note": "No first-hand signal — one tested/measured/built anecdote raises experience weight.", "suggestion": "Add a result you personally measured or a build decision you made."}`.
  No score cap (advisory only).
- [ ] Test: raw reply with `"first_hand": false` → finding present; `true` → absent. Commit.

### Task 2: image alt-text → skimmability (structural) + `alt_text` fix

- [ ] Regex `_IMG_NOALT_RE = re.compile(r"!\[\s*\]\([^)]+\)")`. In the skimmability scorer: per
  empty-alt image add finding `{"section_id": sid, "target": <the image markdown>, "note": "Image has no alt text — invisible to parsers.", "fix": "alt_text"}`
  and deduct 5 each (floor 50) — only when such images exist.
- [ ] Endpoint `POST /geo/alt {section_id, target}` (mirror `/geo/table`): prompt
  `"Write one concise, descriptive alt text (under 120 chars) for the image in this section, from the surrounding prose. Return only the alt text."`;
  response spliced client-side: `target.replace("![]", f"![{alt}]")` — deterministic; panel splices
  + undo + `queueRescore("skimmability")`.
- [ ] Tests: scorer flags `![](x.png)` and not `![diagram](x.png)`; endpoint returns text. Commit.

### Task 3: chunk-length band → chunking (advisory)

- [ ] In the chunking scorer: keep the >400-word deduction; add advisory finding (no deduction) for
  sections under 40 words: `{"section_id": sid, "note": f'"{title}" is thin ({n} words) — too little to stand alone as a cited chunk.'}`.
  Detail string mentions the band: `"Best-cited chunks run ~120-180 words per heading."`.
- [ ] Test: a 10-word section yields the advisory finding and an unchanged score. Commit.

### Task 4: sub-question coverage → faq + FAQ generator `questions` param

- [ ] Schema: top-level `"coverage": {"type": "object", "properties": {"missing_subquestions": {"type": "array", "items": {"type": "string"}}}}`
  (not in `required`); directive gains item 6:
  `"6) coverage: in missing_subquestions list up to 4 natural sub-questions of this topic a search engine would decompose the query into that this draft does NOT answer. Only questions genuinely in-scope for the title."`.
- [ ] `parse_semantic`: attach them as advisory findings on… nothing semantic — instead return them
  in the parse result under a private key `"_missing_subquestions": [...]` and have
  `_run_semantic` merge them into the STRUCTURAL faq lever at report time (`analyze_geo` /
  `rescore_geo` pass them into `score_structural`'s faq lever findings as
  `{"note": f'Not covered: "{q}"', "fix": "faq"}`). Keep wiring minimal: `analyze_geo` builds
  structural first, then semantic, then appends these findings to `structural["faq"]["findings"]`
  before `build_report`.
- [ ] `/geo/faq` endpoint body gains `questions: list[str] = []`; when non-empty the generation
  prompt becomes: `"Answer EXACTLY these reader questions from the post's own content — skip any
  question the draft cannot answer (do not guess): {questions}"` (keep the grounding + voice
  clauses); drop empty answers server-side.
- [ ] Tests: reply with 2 missing subquestions → faq findings gain 2 "Not covered" entries; FAQ
  endpoint with `questions` passes them into the prompt (assert on mock) and filters empties.
  Commit; PR `feat(geo): experience, alt-text, chunk-band, sub-question augments`.

---

# PHASE GEO-5 — target-query export

**Branch:** `feat/geo-queries` · **Files:** `api/geo.py`, `api/geo.ts`, `GeoPanel.tsx`, tests.

- [ ] **Endpoint** `POST /api/drafts/{draft_id}/geo/queries` → JSON schema `{"queries": [str]}`,
  temperature 0, prompt:

```python
prompt = (
    "List 6-10 natural-language search queries (the kind typed into ChatGPT, "
    "Perplexity, or Google) for which this post should be the definitive answer. "
    "Ground them in the post's actual title, headings, and FAQ — no aspirational "
    'topics it does not cover. Return JSON: {"queries": ["..."]}.'
)
```

  Test: mocked reply → 200 list; junk reply → 502 per file convention.
- [ ] **Panel:** "Copy target queries" button in the GeoPanel footer → `geoQueries()` →
  `navigator.clipboard.writeText(queries.join("\n"))` + toast "Copied N target queries — paste
  into ChatGPT/Perplexity weekly and note who gets cited." (honest: measurement is manual,
  outside the tool).
- [ ] Suites green; commit; PR `feat(geo): target-query export for manual citation tracking`.

---

## Self-review

- **Spec coverage:** #1+#3 → GEO-1; #2 → GEO-2; #4 → GEO-3 (+ shipped export dates); #5 → verified
  already shipped (+ description gap in GEO-3); #6/#7/#8/#10 → GEO-4; #9 → GEO-5. Weights +
  normalization → GEO-1 Task 1. All 10 accounted for.
- **Type consistency:** lever dict shape everywhere matches `_lever()` (key/label/score/weight/
  detail/findings/fix); `parse_semantic(raw: str, draft: Draft)` signature unchanged; endpoints
  follow `api/geo.py` conventions; `augment_citations(semantic, draft)` matches the other augments.
- **Placeholders:** the two endpoint tests in GEO-1 Task 3 and fixture-location notes direct the
  executor to mirror named existing files (concrete assertions specified) — deliberate, since those
  harness details live in the repo; all product logic is fully coded above.
- **Known judgment calls:** citations findings cap at 3 (matches factual_density's cap); takeaways
  absent-score 45 (between faq's 30 and comparison's 55 — it's cheaper to add than an FAQ);
  freshness is the only lever that is *always* flag-only (dates can't be generated honestly).
