# Rules refresh (humanize + GEO) and a live Help page

**Date:** 2026-07-09
**Status:** Approved design → ready for implementation plan
**Goal:** (1) Refresh the humanize/AI-tell rules and GEO levers from 2025–2026 research; (2) add a `/help` page that explains every rule the tool applies, rendered **live from the real rule data** so it can never drift.

## Research grounding (agents' reports, July 2026)

- **Humanize:** Wikipedia "Signs of AI writing" (April 2026 version), arXiv stylometry papers (2412.11385, 2606.04177, 2509.10179), detector-vendor frequency data, em-dash-backlash coverage. Key finding: detectors score **structure** (burstiness, template-breaking), not word lists — structural rules deserve more weight than vocabulary; several banished words/openers are false-positive-prone.
- **GEO:** Ahrefs 17M-citation freshness study, Kevin Indig 1.2M-response ChatGPT study, HubSpot semantic-triples experiment (+642% citations), Am I Cited passage-length data, Cyrus Shepard 54-study meta-analysis, Semrush/Profound UGC-bias studies, Princeton GEO (baseline), and **Google's official guide "Optimizing for Generative AI Features on Google Search"** (Search Central, May 2026, updated 2026-06-29) — NOT an academic paper; it confirms query fan-out, names non-commodity content as #1, and declares llms.txt/schema/chunking/AI-style-rewriting useless for Google surfaces.

## 1. Humanize rule changes

### 1.1 Add 9 patterns to `voice/assets/ai-tells/patterns.md` (same bullet format as existing)
1. **Bold-label listicle scaffolding** — bullets shaped `**Label:** explanation` in every item. Fix: prose or varied item shapes.
2. **Colon-subtitle headlines / Title Case headings** — "Unlocking Growth: How X Does Y". Fix: sentence case; keep the concrete half.
3. **Framing sandwich** — conclusion restates intro; sections announce then recap themselves. Fix: delete restating sentences; end on the last new fact.
4. **Both-sides hedging** — "While X offers benefits, it also presents challenges." Fix: commit; make caveats concrete.
5. **Future-outlook coda** — "…poised to play an even greater role" closings. Fix: cut, or attribute a real prediction.
6. **Audience bracketing** — "Whether you're a seasoned dev or just starting out…". Fix: address one reader or cut.
7. **Dictionary lead** — "X refers to…", "X is a term used to describe…". Scope: flags the limp *phrasing* only — a crisp assertive "X is Y" definition stays valid (GEO's definitional opener depends on it).
8. **Paragraph-level uniformity** — runs of same-mass 3–4-sentence paragraphs. Fix: vary paragraph size; allow a one-sentence paragraph.
9. **Knowledge-cutoff residue** — "Based on available information…", bare "As of 2024" hedges with no source. Scope: dated, **attributed** stats ("as of March 2026, per Ahrefs") are GOOD (GEO freshness) — flag only unattributed hedge forms.

("The result? …" fragment pivots are already covered by the existing rhetorical-question rule — no new rule.)

### 1.2 Words/phrases/openers
- **`words.txt` ADD (10):** plethora, ever-evolving, fast-paced, burgeoning, quintessential, unwavering, unparalleled, demystify, unveil, hallmark
- **`words.txt` REMOVE (6, false-positive-prone / domain-normal):** dynamic, navigate, foster, facilitate, versatile, vivid
- **`phrases.txt` ADD (15):** gone are the days; look no further; here's the kicker; but here's the thing; at the end of the day; in a nutshell; picture this; imagine a world where; without further ado; cemented its status; solidified its status; maintains an active presence; crucial role in shaping; treasure trove; poised to
- **`sentence-starters.txt` REMOVE (4):** Therefore, Thus, Meanwhile, Indeed (normal prose connectives; the tell is stacking, which pattern #8/burstiness covers)
- **Em dashes: UNCHANGED.** Deterministic removal stays — it's the product's signature house rule (user's voice), acknowledged as opinion on the help page.

## 2. GEO lever changes

### 2.1 Add 7 levers
| Lever | Detection | Evidence |
|---|---|---|
| `information_gain` | LLM judgment (semantic pass): first-party data / original findings vs re-reported facts | Google guide #1 ("non-commodity content"); ~4.5× citation lift |
| `semantic_triples` | LLM judgment + deterministic hint (S-V-O claim sentences with named-entity subjects) | HubSpot +642% citations |
| `expert_quotes` | Deterministic: quoted span ≥8 words attributed via "said/according to/notes [Name], [Title]" | Princeton quotation-addition; cited pages avg 4.1 vs 2.4 quotes |
| `answer_capsule` | Deterministic: 40–75-word link-free paragraph before the first H2, title entity in first sentence | Indig: 72.4% citation rate; 40–75-word passages cited 3.1× |
| `page_front_load` | Deterministic proxy: share of numeric facts/definitions in first 30% of tokens | Indig: 44.2% of citations from first 30% |
| `intent_format_match` | LLM judgment: infer query archetype from title, check body structure matches | Comparative listicles = 32.5% of AI citations |
| `definitive_language` | Deterministic: hedge-word ratio (may/might/could/perhaps/possibly/arguably) | Indig: definitive "X is" ≈2× citations |

Rejected: `entity_density` (needs NER; proxy too flaky), `readability_simplicity` (weakest evidence; fights the burstiness voice rule).

### 2.2 New normalized weights (27 levers, sum = 1.00)
```
0.09  answer_first
0.07  factual_density
0.06  freshness            (was 0.04 — Ahrefs 17M study, SE Ranking 3.2×)
0.06  citations
0.06  information_gain     (new)
0.05  semantic_triples     (new)
0.05  expert_quotes        (new)
0.05  stat_attribution     (was 0.04 — attributed stats beat raw density)
0.04  answer_capsule       (new)
0.04  page_front_load      (new)
0.04  intent_format_match  (new)
0.04  experience_signals   (was 0.03 — UGC bias + Google guide)
0.04  query_coverage       (fan-out now officially confirmed)
0.03  definitional_opener
0.03  question_headings
0.03  skimmability
0.03  chunking
0.03  brand_explicit
0.02  takeaways
0.02  comparison_table
0.02  faq
0.02  definitive_language  (new)
0.02  entity_consistency
0.02  jargon_defined
0.02  concrete_examples
0.01  sound_bites          (was 0.03 — evidence didn't hold; mechanism belongs to expert_quotes)
0.01  title_shape
```
Update `_WEIGHTS`, `_ORDER` (display order ≈ tier order above), `_LABELS`, `_IMPACTS` (one mechanism sentence each, with the study finding baked in). Semantic pass grows from 4 to 7 judgment levers (add information_gain, semantic_triples, intent_format_match) — prompt, `parse_semantic`, required-keys guard, and the example that `test_semantic_example_covers_all_levers` pins must all be updated.

## 3. Help page

### 3.1 Backend: `GET /api/help/rules` (authed, like other routes)
Serves live rule data from the single source of truth:
```json
{
  "humanize": {
    "words": [...], "phrases": [...], "sentence_starters": [...],
    "patterns": [{"title": "...", "body": "..."}],      // parsed from patterns.md bullets
    "lenses":   [{"key": "flow", "title": "...", "points": ["..."]}]  // parsed from lenses.md
  },
  "geo": {
    "levers": [{"key", "label", "weight", "impact", "detection": "structural|judgment"}],
    "order": [...]
  }
}
```
Parsers live next to the loaders (`voice/ai_tells.py` gains a `parsed_patterns()`; `generate/humanize.py` a `parsed_lenses()`; `generate/geo.py` exposes its tables).

### 3.2 Frontend: `HelpPage.tsx` at `/help`
- **Nav**: "Help" `NavLink` in `AppShell` (before Settings). Route in `App.tsx` under `RequireAuth`.
- **Sections (anchor-linkable)**:
  - `#humanize` — philosophy (structure > word-swaps; the four-stage enforcement pipeline: prompt-time avoidance → deterministic detection → model recast → deterministic backstop), then live lists: pattern rules (title+body cards), banished words (chips), phrases, forbidden openers, the four rewrite lenses. A note that em-dash removal is an opinionated house rule.
  - `#geo` — what GEO is (one paragraph, incl. query fan-out), the honesty rule (structural readiness ≠ citation guarantee), then the 27 levers grouped by weight tier, each with label, weight, impact line, and detection type.
  - `#myths` — hand-written: schema markup (Ahrefs null + Google non-use), llms.txt (SE Ranking null + Google non-use), word count (r≈0.04), keyword stuffing (negative).
  - `#sources` — the key studies with links (Princeton GEO, Google's guide, Ahrefs, Indig, HubSpot, Wikipedia signs-of-AI-writing).
- **Panel deep-links**: small "How these rules work →" links in the headers of LintPanel + HumanizePanel (→ `/help#humanize`) and OptimizePanel + GeoReviewRail (→ `/help#geo`).
- Static prose (philosophy, myths, sources) lives in the HelpPage component; all lists/levers come from the endpoint.

## 4. Versioning & tests
- **Version:** minor bump → **0.5.0** (feature), via `scripts/version.sh`, folded into the same PR.
- **Tests:** geo weight-sum + example-coverage tests updated for 27 levers; new deterministic-lever unit tests (answer_capsule, expert_quotes, definitive_language, page_front_load); ai_tells loader tests updated for new/removed entries; help endpoint test (shape + non-empty lists); frontend HelpPage render test.
- **Deploy:** rebuild bundle + `uv sync` + `launchctl kickstart` (standard).

## 5. Conflict guardrails (both systems must stay coherent)
- Dictionary-lead tell (humanize) vs definitional_opener (GEO): the tell bans the *phrasing* ("refers to"), the lever wants an assertive "X is Y" — document side by side on the help page.
- Knowledge-cutoff residue (humanize) vs freshness (GEO): unattributed hedges are the tell; dated attributed stats are the lever.
- definitive_language (GEO) aligns with the existing voice/hedging lens — no conflict.

## 6. Out of scope (YAGNI)
No off-page GEO (backlinks, llms.txt server config), no NER dependency, no per-pack help customization, no unauthenticated/public help page, no CHANGELOG automation.
