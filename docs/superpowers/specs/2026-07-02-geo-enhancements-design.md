# GEO enhancements — design (all 10)

**Goal:** extend BlogForge's GEO system with the ten researched enhancements: a citations lever with
reference-grounded link/quote fixes, a key-takeaways block, a freshness lever, four augments to
existing levers (first-hand experience, image alt-text, chunk-length band, sub-question coverage),
JSON-LD structured data at export, and a target-query export for citation tracking.

**Status:** approved direction 2026-07-02 ("spec and plan all 10"). Grounding: the Princeton GEO
study (Cite Sources / Quotation Addition / Statistics = top methods, +30-40% visibility) and the
2026 extractability literature (TL;DR blocks, 120-180-word chunks, freshness, FAQPage schema,
E-E-A-T author signals).

**Honesty rules (unchanged, non-negotiable):** the score is structural readiness, not a citation
guarantee. The tool never fabricates facts, sources, quotes, or dates — every generative fix is
grounded in the draft or in author-supplied/attached material, and quotes must be verbatim from an
attached reference (validated server-side).

---

## What exists (context)

9 levers in `packages/api/blogforge/generate/geo.py` — 5 structural (question_headings,
skimmability, faq, chunking, comparison_table) + 4 semantic in one temperature-0 LLM pass
(answer_first, factual_density, definitional_opener, brand_explicit). Weighted total (weights sum
to 1.0, `_WEIGHTS` at geo.py:29), letter grade, per-finding fixes with per-lever re-scoring
(`_STRUCTURAL_KEYS` / `_SEMANTIC_KEYS`, geo.py:664-671), undo + localStorage-tracked additions in
`packages/web/src/components/draft/GeoPanel.tsx` (weights mirrored at lines 53-63).

## The 10 enhancements → 3 new levers, 4 augments, 2 export features, 1 measurement feature

### New weight table (12 levers, sums to 1.00)

| Lever | Weight | Was | Kind |
|---|---|---|---|
| answer_first | .16 | .20 | semantic |
| factual_density | .16 | .20 | semantic |
| **citations** | **.10** | — | **semantic + structural augment** |
| definitional_opener | .08 | .10 | semantic |
| question_headings | .08 | .10 | structural |
| skimmability | .08 | .10 | structural |
| brand_explicit | .06 | .08 | semantic |
| faq | .06 | .08 | structural |
| chunking | .06 | .08 | structural |
| **takeaways** | **.06** | — | **structural** |
| **freshness** | **.06** | — | **structural** |
| comparison_table | .04 | .06 | structural |

The two proven heavyweights keep the top slots; citations (the strongest researched lever we lack)
enters at .10. Frontend `LEVER_WEIGHTS` must mirror exactly.

---

### 1. Citations lever (`citations`, .10) — enhancement #1 + #3

**Measures:** do concrete claims link out to sources? AI engines strongly prefer content whose
claims carry citations ("Cite Sources" was a top-3 Princeton method).

- **Semantic part** (added to the existing single LLM pass): score 0-100 for how well concrete
  claims are attributed/linked; returns up to 3 `uncited_claims` `{target, note}` — passages that
  assert something checkable with no source.
- **Structural augment** (deterministic): count outbound markdown links
  (`[text](http...)`, excluding same-page anchors). Zero outbound links anywhere → cap score at 40.
- **Fix A — `cite_reference`:** per uncited-claim finding, the writer picks one of the draft's
  **attached references** (they already exist — including the new compose-start source URLs); the
  LLM weaves an attribution + link into the passage ("according to <name>", linked) in the author's
  voice, inventing nothing. The reference URL comes from `Reference.url`; references without a URL
  are offered as name-only attribution.
- **Fix B — `quote_reference` (Quotation Addition):** micro-flow: writer picks a reference; a new
  endpoint returns 2-3 **verbatim** candidate quotes lifted from that reference's stored extracted
  markdown (S3: `drafts/{id}/references/extracted/{ref_id}.md`). Server rejects any candidate that
  is not an exact substring of the extracted text (the honesty guard). Writer picks one; the LLM
  weaves it in, quoted and attributed.
- Lever key joins `_SEMANTIC_KEYS`; new endpoints `POST /geo/quotes` (candidates) and the existing
  weave pattern (`add data` flow) reused for insertion.

### 2. Key-takeaways lever (`takeaways`, .06) — enhancement #2

**Measures:** an extractable TL;DR block near the top.
- **Detection (structural):** heading `^#{2,4}\s*(key takeaways|tl;?dr|at a glance|in short)\b`
  (case-insensitive) in the opening or any section, OR a ≥3-bullet list inside the opening hook.
  Present → 100. Absent → 45 with fix.
- **Fix — `takeaways`:** generative + additive (same pattern as the FAQ fix): 3-5 one-line bullets
  grounded strictly in the draft, appended to `outline.opening_hook` under a `**Key takeaways**`
  bold marker. Tracked in GeoPanel's localStorage additions (like opener/FAQ) → removable/undoable,
  and carved out before section rewrites (existing `carveProtectedAdditions` mechanism).
- New endpoint `POST /geo/takeaways`.

### 3. Freshness lever (`freshness`, .06) — enhancement #4

**Measures:** dated, current-looking content (engines — especially Perplexity — prefer it).
- **Detection (deterministic):** (a) absolute dates (`March 2026`, `2026-03`) — month-name+year or
  ISO year-month; (b) "as of <date>" phrasing; (c) an "Updated:" marker. Scoring: date evidence in
  the intro **and** ≥2 dated mentions overall → 100; any dated mention → 70; none → 40.
- **Fix:** flag-only (the tool never invents dates). Findings point at the intro ("no as-of framing")
  and suggest the writer stamp claims with real dates via inline edit.
- **Export tie-in:** already shipped — frontmatter `date`/`lastmod`, JSON-LD dates, and the
  "Updated {month}" byline all exist in `export/render.py`. This phase is the scoring lever only,
  plus one small export gap: add a `description` field to the Article JSON-LD (first ~160 chars of
  the opening).

### 4. Four augments to existing levers — enhancements #6, #7, #8, #10

- **First-hand experience → factual_density (#7):** semantic schema gains
  `first_hand: bool` + note. If false → advisory finding (no cap): "No first-hand signal — one
  tested/measured/built anecdote raises experience weight." Flag-only.
- **Image alt-text → skimmability (#10):** deterministic: flag `![](...)`-style images with empty
  alt text; −5 per image (floor 50) only when images exist. Fix `alt_text`: LLM writes one
  descriptive line from surrounding context; deterministic splice into the image tag.
- **Chunk-length band → chunking (#6):** keep the >400-word flag; add advisory finding for
  sections <40 words ("too thin to stand alone"); lever detail names the 120-180-word citation
  sweet band. No new deductions beyond the advisory.
- **Sub-question coverage → faq (#8):** semantic schema gains `missing_subquestions`
  (≤4 questions an engine would decompose the topic into that the draft doesn't answer). Surfaced
  as advisory findings under the faq lever; the FAQ generator endpoint accepts optional
  `questions: [...]` and answers **only those answerable from the draft** (prompt-guarded; empties
  dropped), so coverage gaps flow directly into the FAQ fix.

### 5. JSON-LD structured data at export — enhancement #5 — **ALREADY SHIPPED**

Verified during spec review: `packages/api/blogforge/export/render.py` already implements the whole
item — `json_ld()` emits Article (headline, author, datePublished/dateModified) plus FAQPage
parsed from the GEO FAQ block (`extract_faqs()`), embedded by `to_html()`, alongside a visible
"Updated {month}" byline and frontmatter `date`/`lastmod` in `to_markdown(frontmatter=True)`.
**No work needed.** (One optional gap noted for GEO-3: an Article `description` field.)

### 6. Target-query export — enhancement #9

`POST /api/drafts/{id}/geo/queries` → LLM generates 6-10 natural-language queries this post should
be the canonical answer for (grounded in title/headings/FAQ; temperature 0). GeoPanel gains a
"Copy target queries" action that puts them on the clipboard — for the writer's manual weekly
citation checks in ChatGPT/Perplexity/AI Overviews. UI copy is honest: measurement happens outside
the tool.

---

## Phasing (one PR each, independently shippable)

| PR | Contents |
|---|---|
| **GEO-1** | Weight rebalance (12 levers) + normalized totals + citations lever + cite_reference & quote_reference fixes + `/geo/quotes` endpoint + GeoPanel plumbing |
| **GEO-2** | Takeaways lever + `/geo/takeaways` + additions tracking |
| **GEO-3** | Freshness lever (scoring only; export dates already shipped) + JSON-LD `description` gap-fill |
| **GEO-4** | The four augments (experience, alt-text, chunk band, sub-questions + FAQ generator extension) |
| **GEO-5** | Target-query endpoint + GeoPanel copy action |

Because levers land across phases, **totals normalize by the sum of the weights present** in a
report (backend `build_report` and frontend `computeTotalScore` both divide by the present-weight
sum). GEO-1 introduces the full 12-key weight table; until GEO-2/3 land, absent levers simply
don't dilute the total. Older cached reports re-score on next scan via the existing
cache-invalidation-on-draft-change path.

## Error handling

- All new endpoints follow the existing GEO endpoint pattern (404 draft scoping, `ProviderError`
  surfaced, model output validated/cleaned with deterministic fallbacks: non-verbatim quotes
  rejected, non-table/non-bullet model replies rejected → clean error, never garbage spliced in).
- Semantic parse failures default new lever scores to 0 with the lever's descriptive note (existing
  `parse_semantic` convention).

## Testing

Per phase: pytest unit tests against `score_structural` / `parse_semantic` / augment functions with
synthetic drafts (no network; LLM mocked exactly like existing `tests/generate/test_geo.py`), plus
endpoint tests for quote-verbatim rejection and FAQ `questions` grounding; vitest for GeoPanel
weight mirror + additions tracking of the takeaways block. Full suites green before each merge.

## Out of scope

- Per-engine sub-scores (ChatGPT vs Perplexity vs AIO weighting) — revisit after these land.
- Site-level artifacts (llms.txt, sitemaps) — BlogForge exports articles, not sites.
- Automated citation tracking against live engines (manual via GEO-6 export for now).
