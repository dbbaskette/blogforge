# Rules Refresh + Help Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline; it edits live rule files and ends with a deploy the user verifies). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh humanize/AI-tell rules and GEO levers per the 2026 research, and add a `/help` page that documents every rule live from the real rule data.

**Architecture:** Humanize rules are data files under `packages/api/blogforge/voice/assets/` (flow into prompts + linter automatically). GEO levers live in `packages/api/blogforge/generate/geo.py` — deterministic levers in `score_structural`, judgment levers via the `_NEW_SEMANTIC_KEYS` generic-schema pattern (schema/example/parser pick up new keys automatically). A new `GET /api/help/rules` endpoint serves parsed rule data; a new `HelpPage.tsx` renders it with hand-written explanations.

**Tech Stack:** Python 3.11 / FastAPI / pytest (`uv run pytest`), React/TS/Vitest (pnpm 9), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-09-rules-refresh-and-help-page-design.md`

## Global Constraints

- Branch: `feat/rules-refresh-help-page` (already created; spec committed).
- **Weights must sum to 1.00 exactly** — `test_weights_sum_to_one` enforces (27 levers per the spec table).
- The semantic example must cover every semantic lever — `test_semantic_example_covers_all_levers` enforces; new keys added via `_NEW_SEMANTIC_KEYS` are covered automatically by the dict comprehension.
- Em-dash enforcement is UNTOUCHED (product house rule).
- Version bump **minor → 0.5.0** via `scripts/version.sh` in the final task (not per-task).
- Run backend tests `uv run pytest packages/api/tests/... -q`; frontend `pnpm -C packages/web exec vitest run ...`.
- Known pre-existing local failures to IGNORE (env, not regressions): `test_voice_pack.py` (myvoice), `test_linkedin_import_endpoint.py` (MinIO), `test_ideation_round_trip.py` (pack fixture).

---

### Task 1: Humanize rule-file updates

**Files:**
- Modify: `packages/api/blogforge/voice/assets/ai-tells/patterns.md` (append 9 bullets)
- Modify: `packages/api/blogforge/voice/assets/ai-tells/words.txt` (+10 / −6)
- Modify: `packages/api/blogforge/voice/assets/ai-tells/phrases.txt` (+15)
- Modify: `packages/api/blogforge/voice/assets/ai-tells/sentence-starters.txt` (−4)
- Test: `packages/api/tests/voice/test_ai_tells_assets.py` (create)

**Interfaces:**
- Consumes: `blogforge.voice.ai_tells.load_ai_tells() -> AiTells` (fields: `words`, `phrases`, `sentence_starters`, `patterns` — the raw markdown string).
- Produces: updated rule data automatically flowing into prompt composition and lint.

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/voice/test_ai_tells_assets.py`:
```python
"""Pin the 2026 research refresh of the universal AI-tell assets."""
from blogforge.voice.ai_tells import load_ai_tells


def test_new_words_added_and_false_positives_removed() -> None:
    words = {w.lower() for w in load_ai_tells().words}
    for added in ("plethora", "ever-evolving", "fast-paced", "burgeoning",
                  "quintessential", "unwavering", "unparalleled", "demystify",
                  "unveil", "hallmark"):
        assert added in words, f"missing new word: {added}"
    for removed in ("dynamic", "navigate", "foster", "facilitate", "versatile", "vivid"):
        assert removed not in words, f"false-positive word still banished: {removed}"


def test_new_phrases_added() -> None:
    phrases = {p.lower() for p in load_ai_tells().phrases}
    for added in ("gone are the days", "at the end of the day", "in a nutshell",
                  "picture this", "without further ado", "poised to",
                  "crucial role in shaping", "treasure trove", "here's the kicker"):
        assert added in phrases, f"missing new phrase: {added}"


def test_connective_openers_unbanned() -> None:
    starters = {s.lower() for s in load_ai_tells().sentence_starters}
    for removed in ("therefore", "thus", "meanwhile", "indeed"):
        assert removed not in starters, f"normal connective still forbidden: {removed}"
    assert "moreover" in starters  # the stacking-tell core stays


def test_new_patterns_present() -> None:
    pats = load_ai_tells().patterns
    for marker in ("Bold-label list scaffolding", "Framing sandwich",
                   "Both-sides hedging", "future-outlook coda",
                   "Audience bracketing", "Dictionary lead",
                   "paragraph-level uniformity", "Knowledge-cutoff residue",
                   "Colon-subtitle headlines"):
        assert marker.lower() in pats.lower(), f"missing pattern: {marker}"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest packages/api/tests/voice/test_ai_tells_assets.py -q`
Expected: 4 failures (none of the additions exist yet).

- [ ] **Step 3: Apply the file edits**

**`patterns.md`** — append these 9 bullets (same format as existing):
```markdown
- **Bold-label list scaffolding.** Don't shape every bullet as `**Label:** explanation sentence`. Uniform bold-label bullets are the most-cited AI formatting tell. Before: "**Scalability:** The platform grows with your needs." After: prose, or bullets whose items vary in shape and carry the point themselves.
- **Colon-subtitle headlines and Title Case headings.** Avoid "Gerund Phrase: How X Does Y" titles ("Unlocking Growth: How AI Is Transforming Small Business") and Title Case on every heading. Use sentence case; delete the colon and keep whichever half says something concrete.
- **Framing sandwich.** Don't restate the intro in the conclusion, and don't open sections with "In this section we'll explore…" then close with "As we've seen…". Delete any sentence that only restates; end on the last new fact, not a recap.
- **Both-sides hedging.** Avoid symmetrical benefit/drawback boilerplate: "While X offers significant benefits, it also presents challenges." Commit to a claim; if a caveat is real, make it concrete ("this breaks when N > 10k"), not generic.
- **No future-outlook coda.** Don't close with vague confident speculation: "As the technology continues to evolve, X is poised to play an even greater role." Cut it, or attribute a real prediction to a named source with a date.
- **Audience bracketing.** Don't open with the false-dichotomy reader address: "Whether you're a seasoned developer or just starting out…". Address one real reader, or cut the clause and start with the substance.
- **Dictionary lead.** Don't define the title like a dictionary: "X refers to…", "X is a term used to describe…". A crisp assertive definition ("Customer churn is the rate customers leave.") is fine — the limp *refers-to* phrasing is the tell.
- **Vary paragraph mass (paragraph-level uniformity).** Don't write runs of same-size 3–4 sentence paragraphs — "perfect rectangles" read as machine output. Allow a one-sentence paragraph for emphasis; let one run long where the argument needs it.
- **Knowledge-cutoff residue.** Cut model-uncertainty leftovers: "Based on available information…", "While specific figures are not publicly available…", and bare "As of 2024" hedges with no source. A dated, attributed fact ("as of March 2026, per Ahrefs") is good; an unattributed hedge is the tell.
```

**`words.txt`** — remove the lines `dynamic`, `navigate`, `foster`, `facilitate`, `versatile`, `vivid`; append:
```
plethora
ever-evolving
fast-paced
burgeoning
quintessential
unwavering
unparalleled
demystify
unveil
hallmark
```

**`phrases.txt`** — append:
```
gone are the days
look no further
here's the kicker
but here's the thing
at the end of the day
in a nutshell
picture this
imagine a world where
without further ado
cemented its status
solidified its status
maintains an active presence
crucial role in shaping
treasure trove
poised to
```

**`sentence-starters.txt`** — delete the lines `Therefore`, `Thus`, `Meanwhile`, `Indeed` (keep the rest).

- [ ] **Step 4: Run tests to verify pass**

Run: `uv run pytest packages/api/tests/voice/test_ai_tells_assets.py packages/api/tests/voice/test_lint_patterns.py packages/api/tests/voice/test_enforce.py -q`
Expected: PASS. (If `test_lint_patterns.py`/`test_enforce.py` assert on a removed word like "dynamic", update those assertions to a kept word such as "robust".)

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/voice/assets/ai-tells packages/api/tests/voice/test_ai_tells_assets.py
git commit -m "feat(voice): 2026 AI-tell refresh — 9 patterns, +10/-6 words, +15 phrases, -4 openers"
```

---

### Task 2: GEO deterministic levers (answer_capsule, page_front_load, definitive_language)

**Files:**
- Modify: `packages/api/blogforge/generate/geo.py` (add 3 checks to `score_structural`, plus module-level helpers)
- Test: `packages/api/tests/generate/test_geo_new_levers.py` (create)

**Interfaces:**
- Consumes: `score_structural(draft) -> dict[str, dict]`, `_lever(key, score, detail, findings=..., fix=...)`, `_draft_text(draft) -> str` (all existing in geo.py).
- Produces: three new keys in the structural result: `answer_capsule`, `page_front_load`, `definitive_language` — same lever-dict shape as existing.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/tests/generate/test_geo_new_levers.py` (mirror the Draft-fixture style used in `test_geo.py` — import its helper if one exists, else build a minimal `Draft` with sections):
```python
"""Deterministic checks for the 2026 lever additions."""
from blogforge.generate.geo import score_structural
from packages.api.tests.generate.test_geo import make_draft  # reuse existing fixture helper
# (If test_geo.py has no importable helper, copy its Draft-construction pattern here.)


def test_answer_capsule_detects_capsule() -> None:
    # ~50-word link-free opening paragraph mentioning the title entity.
    opener = ("BlogForge is a drafting tool that writes long-form posts in your own "
              "voice. It researches a topic, plans one coherent outline, composes the "
              "whole draft in a single pass, and then strips the telltale phrases that "
              "make text read as machine-written, before you edit.")
    d = make_draft(title="BlogForge review", first_para=opener)
    res = score_structural(d)
    assert res["answer_capsule"]["score"] >= 80


def test_answer_capsule_flags_missing_capsule() -> None:
    d = make_draft(title="BlogForge review", first_para="Short.")
    res = score_structural(d)
    assert res["answer_capsule"]["score"] <= 50
    assert res["answer_capsule"]["findings"]


def test_definitive_language_penalizes_hedges() -> None:
    hedgy = ("It might be possible that this could perhaps work. Some believe it "
             "may help. It seems the results could arguably vary somewhat.")
    d = make_draft(body=hedgy)
    res = score_structural(d)
    assert res["definitive_language"]["score"] <= 40
    assert res["definitive_language"]["findings"]


def test_page_front_load_rewards_facts_up_top() -> None:
    front = "We measured 42ms p95. Costs fell 31% in 2026. " * 3
    back = "This is narrative filler with no numbers at all. " * 20
    d = make_draft(body=front + back)
    assert score_structural(d)["page_front_load"]["score"] >= 70
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest packages/api/tests/generate/test_geo_new_levers.py -q`
Expected: FAIL — `KeyError: 'answer_capsule'` etc.

- [ ] **Step 3: Implement the three checks**

In `geo.py`, add module-level helpers near the other regexes:
```python
_MD_LINK_RE = re.compile(r"\[[^\]]+\]\([^)]+\)")
_HEDGE_RE = re.compile(
    r"\b(may|might|could|perhaps|possibly|somewhat|arguably|it seems|it appears|some believe)\b",
    re.IGNORECASE,
)
_DIGIT_RE = re.compile(r"\d")


def _first_paragraph(text: str) -> str:
    for block in text.split("\n\n"):
        b = block.strip()
        if b and not b.startswith("#"):
            return b
    return ""
```

At the end of `score_structural` (before the return), following the `_lever(...)` idiom of the existing checks:
```python
    full = _draft_text(draft)

    # Answer capsule — a 40–75-word link-free opener naming the title entity
    # (Indig: 72.4% citation rate; 40–75-word passages cited 3.1x more).
    para = _first_paragraph(full)
    wc = len(para.split())
    title_tokens = [t for t in re.findall(r"[A-Za-z][\w-]+", draft.title or "") if len(t) > 3]
    first_sentence = para.split(".")[0].lower()
    names_entity = any(t.lower() in first_sentence for t in title_tokens) if title_tokens else True
    capsule_ok = 40 <= wc <= 75 and not _MD_LINK_RE.search(para) and names_entity
    cap_findings = []
    if not capsule_ok:
        why = (
            f"Opening paragraph is {wc} words (target 40–75)" if not 40 <= wc <= 75
            else "Opening paragraph contains links" if _MD_LINK_RE.search(para)
            else "Opening sentence never names the subject"
        )
        cap_findings = [{"target": para[:200], "note": f"{why} — answer engines lift "
                         "self-contained 40–75-word openers verbatim.", "fix": "capsule"}]
    caps = _lever(
        "answer_capsule",
        90 if capsule_ok else (50 if 20 <= wc <= 110 else 30),
        "Opening paragraph works as a liftable answer capsule." if capsule_ok
        else "No 40–75-word self-contained, link-free opening capsule.",
        findings=cap_findings,
        fix="capsule" if cap_findings else None,
    )

    # Page front-load — share of digit-bearing (factual) sentences that land in
    # the first 30% of the document (Indig: 44.2% of citations come from there).
    sentences = [s for s in _SENT_SPLIT_GEO.split(full) if s.strip()]
    facts = [i for i, s in enumerate(sentences) if _DIGIT_RE.search(s)]
    if not facts or len(sentences) < 8:
        front_load = _lever("page_front_load", 50,
                            "Too little factual content to judge front-loading.")
    else:
        cutoff = max(1, int(len(sentences) * 0.30))
        share = sum(1 for i in facts if i < cutoff) / len(facts)
        front_load = _lever(
            "page_front_load",
            min(100, max(20, int(share * 200))),
            f"{int(share * 100)}% of factual sentences sit in the first 30% of the piece.",
        )

    # Definitive language — hedge-word density (definitive "X is" claims are
    # quoted ~2x more; hedged sentences get skipped).
    hedged = [s.strip() for s in sentences if _HEDGE_RE.search(s)]
    ratio = len(hedged) / max(1, len(sentences))
    definitive = _lever(
        "definitive_language",
        max(0, int(100 - ratio * 400)),
        f"{len(hedged)} of {len(sentences)} sentences hedge (may/might/could/perhaps).",
        findings=[{"target": h[:200], "note": "Hedged claim — engines quote statements "
                   "they can lift without qualification.", "fix": "definitive"}
                  for h in hedged[:3]],
        fix="definitive" if hedged else None,
    )
```
Also add near the other regexes: `_SENT_SPLIT_GEO = re.compile(r"(?<=[.!?])\s+")`, and include the three levers in the returned dict alongside the existing ones.

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest packages/api/tests/generate/test_geo_new_levers.py -q`
Expected: PASS. (Existing `test_geo.py` will FAIL on weights/order until Task 3 adds the table entries — that's expected mid-flight; do NOT commit yet if it bothers you, or commit knowing Task 3 lands next. Preferred: proceed to Task 3 and commit both together only if Step 5 below fails.)

- [ ] **Step 5: Commit (if the full geo suite still passes) — otherwise commit after Task 3**

```bash
uv run pytest packages/api/tests/generate -q || echo "expected: weight-table tests red until Task 3"
git add packages/api/blogforge/generate/geo.py packages/api/tests/generate/test_geo_new_levers.py
git commit -m "feat(geo): deterministic levers — answer_capsule, page_front_load, definitive_language"
```

---

### Task 3: GEO semantic levers + the 27-lever weight table

**Files:**
- Modify: `packages/api/blogforge/generate/geo.py` (`_NEW_SEMANTIC_KEYS`, `_SEMANTIC_DIRECTIVE`, `_WEIGHTS`, `_ORDER`, `_LABELS`, `_IMPACTS`)
- Test: `packages/api/tests/generate/test_geo.py` (weight/coverage tests keep passing — update expected counts if hardcoded)

**Interfaces:**
- Consumes: the `_NEW_SEMANTIC_KEYS` generic-lever machinery (schema, `_SEMANTIC_EXAMPLE` comprehension, `parse_semantic` loop at ~line 1001 — all keyed off the tuple).
- Produces: 4 new judgment levers (`information_gain`, `semantic_triples`, `intent_format_match`, `expert_quotes`) and the final 27-lever weight table.

- [ ] **Step 1: Extend `_NEW_SEMANTIC_KEYS`**

```python
_NEW_SEMANTIC_KEYS = (
    "stat_attribution",
    "query_coverage",
    "sound_bites",
    "entity_consistency",
    "experience_signals",
    "jargon_defined",
    "concrete_examples",
    "title_shape",
    # 2026 research batch:
    "information_gain",
    "semantic_triples",
    "intent_format_match",
    "expert_quotes",
)
```
(Schema, example, and parser pick these up automatically.)

- [ ] **Step 2: Append 4 numbered items to `_SEMANTIC_DIRECTIVE`** (after item 13, same voice):

```python
    "14) information_gain: does the draft contain ORIGINAL information — first-party "
    "data ('we measured', 'our benchmark'), a novel case study, or a distinct point of "
    "view — beyond what any summary of existing sources would say? Google's guidance "
    "calls this 'non-commodity content' and it is the top citation driver. Flag "
    "sections that only re-report common knowledge (suggestion = what first-party "
    "detail the author could add). Never invent data.\n"
    "15) semantic_triples: are the key claims stated as standalone subject-verb-object "
    "assertions with a concrete named subject ('BlogForge strips AI tells "
    "deterministically'), especially early in paragraphs and bullets? Flag key claims "
    "buried in subordinate clauses (suggestion = the same claim recast as a direct "
    "S-V-O sentence, preserving meaning).\n"
    "16) intent_format_match: infer the query archetype the title targets (best/top → "
    "comparative list; how-to → numbered steps; what-is → definition + Q&A) and score "
    "whether the BODY structure matches it. Flag the mismatch (note = expected format, "
    "suggestion = the structural change).\n"
    "17) expert_quotes: does the piece quote named third-party experts with stated "
    "credentials ('said Jane Doe, CTO at Acme')? Distinct from sound_bites (the "
    "author's own lines). Flag sections that assert expert-level claims with no "
    "third-party voice (suggestion = what kind of expert/source to quote). Never "
    "fabricate quotes.\n"
```

- [ ] **Step 3: Replace the `_WEIGHTS` table with the spec's 27-lever table** (copy exactly; sums to 1.00):

```python
_WEIGHTS: dict[str, float] = {
    "answer_first": 0.09,
    "factual_density": 0.07,
    "freshness": 0.06,
    "citations": 0.06,
    "information_gain": 0.06,
    "semantic_triples": 0.05,
    "expert_quotes": 0.05,
    "stat_attribution": 0.05,
    "answer_capsule": 0.04,
    "page_front_load": 0.04,
    "intent_format_match": 0.04,
    "experience_signals": 0.04,
    "query_coverage": 0.04,
    "definitional_opener": 0.03,
    "question_headings": 0.03,
    "skimmability": 0.03,
    "chunking": 0.03,
    "brand_explicit": 0.03,
    "takeaways": 0.02,
    "comparison_table": 0.02,
    "faq": 0.02,
    "definitive_language": 0.02,
    "entity_consistency": 0.02,
    "jargon_defined": 0.02,
    "concrete_examples": 0.02,
    "sound_bites": 0.01,
    "title_shape": 0.01,
}
```
Update `_ORDER` to the same 27 keys in the order above. Add `_LABELS` entries: `information_gain: "Original information"`, `semantic_triples: "Direct S-V-O claims"`, `intent_format_match: "Format matches intent"`, `expert_quotes: "Named expert quotes"`, `answer_capsule: "Answer capsule up top"`, `page_front_load: "Facts front-loaded"`, `definitive_language: "Definitive language"`. Add `_IMPACTS` (one mechanism sentence each, citing the finding — e.g. information_gain: "Engines prefer non-commodity content — pages with first-party data are ~4.5x more likely to be cited than re-reported summaries.").

- [ ] **Step 4: Run the full geo suite**

Run: `uv run pytest packages/api/tests/generate -q`
Expected: PASS — `test_weights_sum_to_one`, the labels/order superset check, and `test_semantic_example_covers_all_levers` all green with 27 levers. Fix any test that hardcodes lever counts.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/geo.py packages/api/tests/generate
git commit -m "feat(geo): 4 semantic levers + research-backed 27-lever reweighting"
```

---

### Task 4: Help rules endpoint

**Files:**
- Modify: `packages/api/blogforge/voice/ai_tells.py` (add `parsed_patterns()`)
- Modify: `packages/api/blogforge/generate/humanize.py` (add `parsed_lenses()`)
- Modify: `packages/api/blogforge/generate/geo.py` (add `lever_catalog()`)
- Create: `packages/api/blogforge/api/help.py`
- Modify: `packages/api/blogforge/server.py` (import + `app.include_router(help_router)` in the block at ~line 243)
- Test: `packages/api/tests/api/test_help_endpoint.py` (create)

**Interfaces:**
- Produces: `GET /api/help/rules` (authed) returning `{"humanize": {words, phrases, sentence_starters, patterns:[{title,body}], lenses:[{key,title,points}]}, "geo": {"levers":[{key,label,weight,impact,detection}]}}`.

- [ ] **Step 1: Write the failing endpoint test** (mirror an existing authed-endpoint test's client fixture, e.g. from `tests/api/`):

```python
async def test_help_rules_shape(signed_admin_client) -> None:
    r = await signed_admin_client.get("/api/help/rules")
    assert r.status_code == 200
    j = r.json()
    h, g = j["humanize"], j["geo"]
    assert "plethora" in [w.lower() for w in h["words"]]
    assert h["patterns"] and all(p["title"] and p["body"] for p in h["patterns"])
    assert {l["key"] for l in h["lenses"]} == {"flow", "voice", "imperfections", "soul"}
    levers = {l["key"]: l for l in g["levers"]}
    assert len(levers) == 27
    assert abs(sum(l["weight"] for l in g["levers"]) - 1.0) < 1e-9
    assert levers["information_gain"]["detection"] == "judgment"
    assert levers["answer_capsule"]["detection"] == "structural"
    assert all(l["impact"] for l in g["levers"])
```

- [ ] **Step 2: Run to verify 404/failure** — `uv run pytest packages/api/tests/api/test_help_endpoint.py -q`

- [ ] **Step 3: Implement the parsers + router**

`ai_tells.py`:
```python
_PATTERN_BULLET = re.compile(r"^- \*\*(.+?)\*\*\s*(.*)$")

def parsed_patterns() -> list[dict[str, str]]:
    """patterns.md bullets as {title, body} for the help page."""
    out = []
    for line in load_ai_tells().patterns.splitlines():
        m = _PATTERN_BULLET.match(line.strip())
        if m:
            out.append({"title": m.group(1).rstrip("."), "body": m.group(2).strip()})
    return out
```
`humanize.py` (`parsed_lenses()`): split the bundled lenses markdown on `^## ` headers shaped `key — Title`; collect `- ` lines as `points`; skip the GUARDRAIL section (or include it as `key="guardrail"` — include it; the help page shows it).
`geo.py`:
```python
def lever_catalog() -> list[dict[str, object]]:
    semantic = set(_SEMANTIC_KEYS)
    return [
        {"key": k, "label": _LABELS[k], "weight": _WEIGHTS[k], "impact": _IMPACTS.get(k, ""),
         "detection": "judgment" if k in semantic else "structural"}
        for k in _ORDER
    ]
```
`api/help.py` (pattern-match `providers.py`):
```python
"""GET /api/help/rules — live rule data for the Help page."""
from fastapi import APIRouter, Depends

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.generate.geo import lever_catalog
from blogforge.generate.humanize import parsed_lenses
from blogforge.voice.ai_tells import load_ai_tells, parsed_patterns

router = APIRouter(prefix="/api/help", tags=["help"])


@router.get("/rules")
async def help_rules(current: User = Depends(get_current_user)) -> dict[str, object]:
    tells = load_ai_tells()
    return {
        "humanize": {
            "words": sorted(tells.words, key=str.lower),
            "phrases": sorted(tells.phrases, key=str.lower),
            "sentence_starters": list(tells.sentence_starters),
            "patterns": parsed_patterns(),
            "lenses": parsed_lenses(),
        },
        "geo": {"levers": lever_catalog()},
    }
```
Register in `server.py`: `from blogforge.api.help import router as help_router` + `app.include_router(help_router)`.

- [ ] **Step 4: Run to verify pass** — `uv run pytest packages/api/tests/api/test_help_endpoint.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/api/help.py packages/api/blogforge/voice/ai_tells.py \
  packages/api/blogforge/generate/humanize.py packages/api/blogforge/generate/geo.py \
  packages/api/blogforge/server.py packages/api/tests/api/test_help_endpoint.py
git commit -m "feat(api): /api/help/rules — live rule catalog for the help page"
```

---

### Task 5: Help page frontend

**Files:**
- Create: `packages/web/src/api/help.ts`
- Create: `packages/web/src/routes/HelpPage.tsx`
- Modify: `packages/web/src/App.tsx` (route `/help` under `RequireAuth`, after `/settings`)
- Modify: `packages/web/src/components/AppShell.tsx` (NavLink "Help" before Settings, ~line 122)
- Modify: `packages/web/src/components/draft/LintPanel.tsx`, `HumanizePanel.tsx` (header link → `/help#humanize`); `OptimizePanel.tsx`, `GeoReviewRail.tsx` (header link → `/help#geo`)
- Test: `packages/web/tests/routes/HelpPage.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/help/rules` (Task 4 shape) via the existing `api()` fetch helper (see `src/api/providers.ts` for the pattern).
- Produces: `/help` route with anchor sections `#humanize`, `#geo`, `#myths`, `#sources`.

- [ ] **Step 1: Write the failing render test** (mock the api module like `SetupFields.test.tsx` mocks providers):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/help", () => ({
  getHelpRules: vi.fn().mockResolvedValue({
    humanize: {
      words: ["plethora"], phrases: ["at the end of the day"], sentence_starters: ["Moreover"],
      patterns: [{ title: "Framing sandwich", body: "Don't restate the intro." }],
      lenses: [{ key: "flow", title: "Flow & Rhythm", points: ["Vary sentence length."] }],
    },
    geo: { levers: [{ key: "answer_first", label: "Answer-first sections", weight: 0.09,
                      impact: "Engines quote the first 40-60 words.", detection: "judgment" }] },
  }),
}));

import { HelpPage } from "../../src/routes/HelpPage";

describe("HelpPage", () => {
  it("renders live rule data in all sections", async () => {
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("plethora")).toBeInTheDocument());
    expect(screen.getByText("Framing sandwich")).toBeInTheDocument();
    expect(screen.getByText("Answer-first sections")).toBeInTheDocument();
    expect(screen.getByText(/llms\.txt/i)).toBeInTheDocument(); // myths section
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm -C packages/web exec vitest run tests/routes/HelpPage.test.tsx` → module-not-found.

- [ ] **Step 3: Implement**

`src/api/help.ts`:
```ts
import { api } from "./client";  // match the import used by src/api/providers.ts

export interface HelpPattern { title: string; body: string }
export interface HelpLens { key: string; title: string; points: string[] }
export interface HelpLever { key: string; label: string; weight: number; impact: string; detection: "structural" | "judgment" }
export interface HelpRules {
  humanize: { words: string[]; phrases: string[]; sentence_starters: string[]; patterns: HelpPattern[]; lenses: HelpLens[] };
  geo: { levers: HelpLever[] };
}
export function getHelpRules(): Promise<HelpRules> { return api("/api/help/rules"); }
```

`HelpPage.tsx` — one component, four anchor sections, existing design tokens (`nb-card`, `glass-card`, `text-muted`, chips). Content outline (hand-written prose is written here, verbatim in the component):
- **Header**: "How BlogForge's rules work" + one-line: "Everything below is read live from the rules the tool actually enforces."
- **`#humanize`**: (1) philosophy paragraph — detectors and readers key on *structure* (rhythm, templates), not word swaps, so the pattern rules matter most; (2) the four-stage pipeline as a numbered strip: *prompt-time avoidance → deterministic detection → model recast → deterministic backstop*; note "Em dashes are removed outright — an opinionated house rule of this tool, not a claim that humans never use them."; (3) pattern cards from `patterns`; (4) chip grids for `words` / `phrases` / `sentence_starters` (collapsible `<details>` since words ≈ 90); (5) the four lenses + guardrail from `lenses`.
- **`#geo`**: intro paragraph (what GEO is; engines retrieve → read passages → cite; query fan-out is officially documented by Google) + honesty note ("the score measures structural readiness, not a citation guarantee"); levers rendered as rows grouped into tiers by weight (≥0.05 "Core", 0.03–0.04 "Strong", ≤0.02 "Refinement") each showing label, weight (as %), impact sentence, and a `structural`/`judgment` badge.
- **`#myths`**: static cards — Schema markup (Ahrefs 1,885-page controlled test: no uplift; Google: "isn't required"); llms.txt (SE Ranking 300K domains: no correlation; Google Search doesn't use it); Word count (Ahrefs: r ≈ 0.04; 53% of cited pages < 1,000 words); Keyword stuffing (negative since the original Princeton study).
- **`#sources`**: link list — Princeton GEO (arXiv 2311.09735), Google "Optimizing for Generative AI Features" guide, Ahrefs freshness study, Kevin Indig citation study, HubSpot semantic-triples experiment, Wikipedia "Signs of AI writing".
- On mount: `useEffect` to scroll to `location.hash` target if present.

Route in `App.tsx` (copy the `/settings` Route block, path `/help`, element `<HelpPage />`). Nav in `AppShell.tsx`:
```tsx
<NavLink to="/help" className="nb-btn-ghost nb-btn nb-btn-sm">
  Help
</NavLink>
```
Panel links — in each panel's header block add (adjusting `#anchor` per panel):
```tsx
<Link to="/help#humanize" className="text-xs text-muted underline underline-offset-2 hover:text-ink">
  How these rules work →
</Link>
```
(`LintPanel` + `HumanizePanel` → `#humanize`; `OptimizePanel` + `GeoReviewRail` → `#geo`. Import `Link` from react-router-dom.)

- [ ] **Step 4: Run tests + build**

Run: `pnpm -C packages/web exec vitest run tests/routes/HelpPage.test.tsx && pnpm -C packages/web build`
Expected: test PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/help.ts packages/web/src/routes/HelpPage.tsx \
  packages/web/src/App.tsx packages/web/src/components/AppShell.tsx \
  packages/web/src/components/draft/LintPanel.tsx packages/web/src/components/draft/HumanizePanel.tsx \
  packages/web/src/components/draft/OptimizePanel.tsx packages/web/tests/routes/HelpPage.test.tsx
git commit -m "feat(web): /help page — live humanize + GEO rule explainer with panel deep-links"
```

---

### Task 6: Version 0.5.0, full verification, deploy

**Files:**
- Modify: `packages/web/package.json` + `packages/api/blogforge/__init__.py` (via `scripts/version.sh`)

- [ ] **Step 1: Bump minor** — `scripts/version.sh minor && scripts/version.sh check` → `0.4.3 → 0.5.0`, in sync.

- [ ] **Step 2: Full test suites**

```bash
uv run pytest packages/api/tests -q
pnpm -C packages/web exec vitest run
```
Expected: all green except the 4 known pre-existing env failures (myvoice / MinIO / pack fixture — listed in Global Constraints).

- [ ] **Step 3: Build + deploy**

```bash
APP_VERSION=$(node -p "require('./packages/web/package.json').version")
GIT_SHA=$(git rev-parse --short HEAD)
( cd packages/web && VITE_APP_VERSION="$APP_VERSION" VITE_GIT_SHA="$GIT_SHA" pnpm build )
rm -rf packages/api/blogforge/static && mkdir -p packages/api/blogforge/static
cp -R packages/web/dist/. packages/api/blogforge/static/
uv sync
launchctl kickstart -k gui/$(id -u)/com.baskettecase.blogforge
curl --retry 30 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:7880/api/health
```
Expected: `{"status":"ok","version":"0.5.0"}`.

- [ ] **Step 4: Live verification (browser, normal reload — no-cache now works)**

- `/help` loads from the nav; all four sections populated; words/phrases lists show the new entries (spot-check "plethora" present, "dynamic" absent).
- A draft's Optimize panel shows the new levers and links to `/help#geo`; Proofread/Humanize link to `/help#humanize`.
- Run a Checkup on a draft → GEO score computes with 27 levers, no errors in `~/.blogforge/serve.log`.

- [ ] **Step 5: Commit the bump**

```bash
git add packages/web/package.json packages/api/blogforge/__init__.py
git commit -m "chore(release): bump to 0.5.0 — rules refresh + help page"
```

- [ ] **Step 6: Hand off** — report done; push → PR → merge on the user's go (their established flow).

---

## Verification Summary

| Task | Gate |
|---|---|
| 1 | `test_ai_tells_assets.py` green; lint/enforce suites green |
| 2 | `test_geo_new_levers.py` green |
| 3 | full `tests/generate` green — weights sum 1.00, example covers 27 levers |
| 4 | `test_help_endpoint.py` green (27 levers, shape, non-empty) |
| 5 | HelpPage test green; `pnpm build` clean |
| 6 | suites green (minus known env failures); live `/help` verified in browser; `/api/health` = 0.5.0 |
