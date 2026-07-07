# Humanize Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "Humanize" pass to the BlogForge draft editor that rewrites prose to read as human, organized into 4 lenses gated by a Light/Medium/Strong dial, and fold its findings into the existing "Reads X% human" score.

**Architecture:** Backend `generate/humanize.py` mirrors `generate/geo.py` (one LLM pass → a lens-grouped report), with rubric text in a bundled `voice/assets/humanize/` asset and a `POST /api/drafts/{id}/humanize` endpoint. Frontend plugs into the shared `Issue` pipeline (`lib/issues/*` → `IssueCard` + `useIssueLifecycle`) via a new `humanizeAdapter`, a thin `HumanizeReviewRail`, a `HumanizePanel` slide-in with the dial, client-side caching in `panelCache.ts`, and a blended `humanness` score in `checkup.ts`. Generation prompts are untouched.

**Tech Stack:** Python 3.12 + FastAPI + Pydantic + pytest/pytest-asyncio (api); React + TypeScript + Vitest + Testing Library (web). LLM via the async `LLMProvider.complete(model, prompt, json_schema)` protocol.

**Spec:** `docs/superpowers/specs/2026-07-07-humanize-pass-design.md`

---

## File Structure

**Backend (`packages/api/blogforge/`)**
- Create `voice/assets/humanize/lenses.md` — the 4 lens rubrics (curated 7 tips).
- Create `generate/humanize.py` — rubric loader, intensity gating, guardrail, prompt, parser, `analyze_humanize`, `build_humanize_report`.
- Create `api/humanize.py` — `POST /api/drafts/{id}/humanize` router.
- Modify `api/server.py` — register the router.
- Create tests: `tests/generate/test_humanize.py`, `tests/api/test_humanize_route.py`.

**Frontend (`packages/web/src/`)**
- Create `api/humanize.ts` — `analyzeHumanize` client + `HumanizeReport` types.
- Create `lib/issues/humanizeAdapter.ts` — findings → `Issue[]`.
- Create `lib/issues/humanizeApply.ts` — `makeHumanizeApply` / `makeHumanizeSave`.
- Create `lib/humanizeDismissals.ts` — localStorage dismiss/restore.
- Create `components/draft/HumanizeReviewRail.tsx` and `components/draft/HumanizePanel.tsx`.
- Modify `lib/issues/types.ts` (add `"humanize"` to `Issue.panel`), `lib/panelCache.ts` (add `"humanize"` to `PanelKind`), `lib/checkup.ts` (blended score + 4th row), `components/draft/CheckupPanel.tsx` (4th fan-out), `components/draft/WorkspaceFooter.tsx` (menu item), `components/draft/DraftWorkspace.tsx` (state + mount).
- Create tests: `tests/lib/issues/humanizeAdapter.test.ts`, `tests/lib/issues/humanizeApply.test.ts`, `tests/lib/humanizeDismissals.test.ts`, `tests/components/HumanizeReviewRail.test.tsx`, and extend `tests/lib/checkup.test.ts`.

Run all backend tests: `cd packages/api && uv run pytest`. Run one: `uv run pytest tests/generate/test_humanize.py -v`.
Run all frontend tests: `cd packages/web && npm test`. Run one: `npm test -- humanizeAdapter`.

---

## Phase A — Backend rules: rubric asset, intensity gating, guardrail (no LLM)

### Task A1: Lens rubric asset + loader

**Files:**
- Create: `packages/api/blogforge/voice/assets/humanize/lenses.md`
- Create: `packages/api/blogforge/generate/humanize.py`
- Test: `packages/api/tests/generate/test_humanize.py`

- [ ] **Step 1: Write the rubric asset**

Create `packages/api/blogforge/voice/assets/humanize/lenses.md`:

```markdown
## flow — Flow & Rhythm
- Real thinking is not metronomic. Some thoughts land in three words; others unspool across a long clause before they resolve. Break any run of same-length sentences.
- Read each sentence as if said aloud. Where a real speaker would pause or change pace, the writing should too. A sentence with nowhere to breathe reads like a document, not a person.
- Vary how paragraphs open. Do not march.

## voice — Voice & POV
- The writer has a stance. Say what they actually think, not a balanced survey of what could be thought.
- Let a small qualification or contradiction stand ("I was mostly wrong about that"). Real opinions have edges.
- Neutral-observer hedging ("it can be argued", "some might say") is a tell. Cut it or commit.

## imperfections — Imperfections
- Lived-in writing has texture: a strong aside, a beat of hesitation, occasionally an incomplete sentence where the rhythm calls for one.
- Do not smooth every edge. One deliberate rough spot beats uniform polish.
- Only the kind of imperfection someone who actually did the thing would leave in. Never add filler or errors for their own sake.

## soul — De-robot / Soul
- Find the sentences that sound most manufactured — too precise, too constructed, too eager to please — and rewrite them as if telling a friend who already trusts you.
- Over-polish reads as untrustworthy. If a line sounds optimized, loosen it.
- Kill formula tells: the setup-then-payoff, the forced rule-of-three, the tidy summary bow.

## GUARDRAIL (all lenses)
Change wording, rhythm, and stance only. Never invent, drop, or alter a fact, number, name, quotation, or link. Never rewrite the article's opening answer sentence.
```

- [ ] **Step 2: Write the failing test**

Create `packages/api/tests/generate/test_humanize.py`:

```python
from pathlib import Path

from blogforge.generate import humanize


def test_load_rubric_bundled_has_all_lenses():
    text = humanize.load_rubric(None)
    for lens in ("flow", "voice", "imperfections", "soul"):
        assert f"## {lens}" in text


def test_load_rubric_pack_override(tmp_path: Path):
    override = tmp_path / "humanize" / "lenses.md"
    override.parent.mkdir(parents=True)
    override.write_text("## flow — custom\noverride body\n", encoding="utf-8")
    text = humanize.load_rubric(tmp_path)
    assert "override body" in text
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -v`
Expected: FAIL with `ModuleNotFoundError` / `AttributeError: module 'blogforge.generate.humanize' has no attribute 'load_rubric'`.

- [ ] **Step 4: Write minimal implementation**

Create `packages/api/blogforge/generate/humanize.py`:

```python
"""On-demand Humanize pass — additive 'sound human' rewrites, complementing
the subtractive anti-AI-tells Humanizer. Mirrors generate/geo.py."""
from __future__ import annotations

from functools import lru_cache
from importlib import resources
from pathlib import Path


@lru_cache(maxsize=1)
def _bundled_rubric() -> str:
    return (
        resources.files("blogforge.voice")
        .joinpath("assets/humanize/lenses.md")
        .read_text(encoding="utf-8")
    )


def load_rubric(pack_root: Path | None) -> str:
    """Bundled lens rubric, or a per-pack override at ``<pack>/humanize/lenses.md``."""
    if pack_root is not None:
        override = pack_root / "humanize" / "lenses.md"
        if override.is_file():
            return override.read_text(encoding="utf-8")
    return _bundled_rubric()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Verify the asset ships as package data**

Run: `cd packages/api && uv run python -c "from blogforge.generate import humanize; print(humanize.load_rubric(None)[:20])"`
Expected: prints `## flow — Flow & Rh`. If it raises `FileNotFoundError`, add `blogforge.voice.assets.humanize` (or a `*.md` glob) to the package-data config in `packages/api/pyproject.toml` the same way `assets/ai-tells` is included, then re-run.

- [ ] **Step 7: Commit**

```bash
git add packages/api/blogforge/voice/assets/humanize/lenses.md packages/api/blogforge/generate/humanize.py packages/api/tests/generate/test_humanize.py
git commit -m "feat(humanize): lens rubric asset + loader with per-pack override"
```

### Task A2: Intensity → lens gating

**Files:**
- Modify: `packages/api/blogforge/generate/humanize.py`
- Test: `packages/api/tests/generate/test_humanize.py`

- [ ] **Step 1: Write the failing test** (append to `test_humanize.py`)

```python
def test_lenses_for_light_excludes_voice_and_imperfections():
    assert humanize.lenses_for("light") == ("flow", "soul")


def test_lenses_for_medium_adds_voice():
    assert humanize.lenses_for("medium") == ("flow", "soul", "voice")


def test_lenses_for_strong_includes_all_four():
    assert set(humanize.lenses_for("strong")) == {"flow", "soul", "voice", "imperfections"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py::test_lenses_for_light_excludes_voice_and_imperfections -v`
Expected: FAIL — `AttributeError: ... has no attribute 'lenses_for'`.

- [ ] **Step 3: Write minimal implementation** (add to `humanize.py`, above `load_rubric`)

```python
from typing import Literal

Intensity = Literal["light", "medium", "strong"]
Lens = Literal["flow", "voice", "imperfections", "soul"]

# Dial gate: which lenses engage at each intensity. Order = display order.
INTENSITY_LENSES: dict[Intensity, tuple[Lens, ...]] = {
    "light": ("flow", "soul"),
    "medium": ("flow", "soul", "voice"),
    "strong": ("flow", "soul", "voice", "imperfections"),
}

LENS_LABELS: dict[Lens, str] = {
    "flow": "Flow & Rhythm",
    "voice": "Voice & POV",
    "imperfections": "Imperfections",
    "soul": "De-robot / Soul",
}


def lenses_for(intensity: Intensity) -> tuple[Lens, ...]:
    return INTENSITY_LENSES[intensity]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/humanize.py packages/api/tests/generate/test_humanize.py
git commit -m "feat(humanize): intensity->lens gating map"
```

### Task A3: Guardrail diff-check

**Files:**
- Modify: `packages/api/blogforge/generate/humanize.py`
- Test: `packages/api/tests/generate/test_humanize.py`

- [ ] **Step 1: Write the failing test** (append)

```python
def test_guard_flags_changed_number():
    assert humanize.needs_review("freed 11 GB of memory", "freed 12 GB of memory") is True


def test_guard_flags_changed_link():
    assert humanize.needs_review(
        "see [docs](https://a.com)", "see [docs](https://b.com)"
    ) is True


def test_guard_allows_pure_tone_change():
    assert humanize.needs_review(
        "The API serves as a gateway that boasts low latency.",
        "The API is the gateway. It adds 5ms.",
    ) is False  # 5ms preserved as the only number in both


def test_guard_allows_tone_change_no_numbers():
    assert humanize.needs_review(
        "This represents a significant improvement to the workflow.",
        "This just makes the workflow better. Noticeably.",
    ) is False
```

Note the third case: both texts contain `5ms`/`5ms`? They don't — rewrite drops "low latency", adds "5ms". Adjust the fixture so numbers match:

```python
def test_guard_allows_pure_tone_change():
    assert humanize.needs_review(
        "The API adds 5ms and serves as a robust gateway.",
        "The API adds 5ms. That is the whole story.",
    ) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -k guard -v`
Expected: FAIL — `AttributeError: ... has no attribute 'needs_review'`.

- [ ] **Step 3: Write minimal implementation** (add to `humanize.py`)

```python
import re

_NUM_RE = re.compile(r"\d[\d,.]*")
_URL_RE = re.compile(r"https?://\S+|\]\(([^)]+)\)")
_QUOTE_RE = re.compile(r'"([^"]+)"')


def _facts(text: str) -> set[str]:
    nums = {n.rstrip(".,") for n in _NUM_RE.findall(text)}
    urls = {m.group(1) or m.group(0) for m in _URL_RE.finditer(text)}
    quotes = {q.strip() for q in _QUOTE_RE.findall(text)}
    return nums | urls | quotes


def needs_review(target: str, suggestion: str) -> bool:
    """True when the rewrite changes any number, link, or quoted span — the
    guardrail: Humanize edits tone/rhythm/phrasing, never facts."""
    return _facts(target) != _facts(suggestion)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -v`
Expected: PASS (9 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/humanize.py packages/api/tests/generate/test_humanize.py
git commit -m "feat(humanize): guardrail diff-check (numbers/links/quotes)"
```

---

## Phase B — Backend pass: prompt, parser, report

### Task B1: Prompt builder + response parser

**Files:**
- Modify: `packages/api/blogforge/generate/humanize.py`
- Test: `packages/api/tests/generate/test_humanize.py`

Context — reuse the GEO title→id mapping idiom (`geo.py::parse_semantic` line ~696) and the lede convention: the opening hook is `draft.outline.opening_hook`, addressed with section id `"opening"`.

- [ ] **Step 1: Write the failing test** (append). Build a draft fixture and feed raw JSON to the pure parser.

```python
from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, Section


def _draft() -> Draft:
    return Draft(
        title="T",
        idea=IdeaInput(topic="t", provider="claude-cli", model="opus"),
        outline=OutlineProposal(opening_hook="This tool cuts deploy time to a minute."),
        sections=[Section(id="s1", title="The Setup", content_md="The API serves as a gateway. It adds 5ms.")],
        references=[],
    )


def test_parse_locates_target_and_maps_section():
    raw = (
        '{"lenses": {"soul": [{"section": "The Setup", '
        '"target": "The API serves as a gateway.", '
        '"suggestion": "The API is the gateway.", "note": "puffery"}]}}'
    )
    report = humanize.parse_humanize(raw, _draft(), ("soul",))
    lens = next(g for g in report["lenses"] if g["key"] == "soul")
    f = lens["findings"][0]
    assert f["section_id"] == "s1"
    assert f["target"] == "The API serves as a gateway."
    assert f["needs_review"] is False


def test_parse_drops_finding_whose_target_is_absent():
    raw = '{"lenses": {"flow": [{"section": "The Setup", "target": "not in the text", "suggestion": "x", "note": "n"}]}}'
    report = humanize.parse_humanize(raw, _draft(), ("flow",))
    lens = next(g for g in report["lenses"] if g["key"] == "flow")
    assert lens["findings"] == []


def test_parse_maps_opening_section():
    raw = '{"lenses": {"flow": [{"section": "opening", "target": "This tool cuts deploy time to a minute.", "suggestion": "This tool cuts deploys to a minute. Really.", "note": "rhythm"}]}}'
    report = humanize.parse_humanize(raw, _draft(), ("flow",))
    f = next(g for g in report["lenses"] if g["key"] == "flow")["findings"][0]
    assert f["section_id"] == "opening"


def test_parse_tolerates_junk_json():
    report = humanize.parse_humanize("not json", _draft(), ("flow",))
    assert report["lenses"] == [{"key": "flow", "label": "Flow & Rhythm", "findings": []}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -k parse -v`
Expected: FAIL — `AttributeError: ... has no attribute 'parse_humanize'`.

- [ ] **Step 3: Write minimal implementation** (add to `humanize.py`)

```python
import json
from typing import Any

from blogforge.drafts.models import Draft


def _key(title: str) -> str:
    return " ".join(title.lower().split())


def _section_text(draft: Draft, sid: str) -> str:
    if sid == "opening":
        return draft.outline.opening_hook if draft.outline else ""
    for s in draft.sections:
        if s.id == sid:
            return s.content_md
    return ""


def parse_humanize(
    raw: str, draft: Draft, engaged: tuple[Lens, ...]
) -> dict[str, Any]:
    """JSON -> lens-grouped report. Locates each target verbatim in its section
    (dropping any that don't match) and flags fact-changing rewrites."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        data = {}
    lenses_in = data.get("lenses", {}) if isinstance(data, dict) else {}

    by_title = {_key(s.title): s.id for s in draft.sections}
    by_title["opening"] = "opening"

    groups: list[dict[str, Any]] = []
    for lens in engaged:
        findings: list[dict[str, Any]] = []
        for item in lenses_in.get(lens, []) or []:
            if not isinstance(item, dict):
                continue
            target = str(item.get("target", "")).strip()
            suggestion = str(item.get("suggestion", "")).strip()
            sid = by_title.get(_key(str(item.get("section", ""))))
            if not target or not suggestion or sid is None:
                continue
            if target not in _section_text(draft, sid):
                continue  # target must exist verbatim to be applied
            findings.append({
                "lens": lens,
                "section_id": sid,
                "target": target,
                "suggestion": suggestion,
                "note": str(item.get("note", "")).strip(),
                "needs_review": needs_review(target, suggestion),
            })
        groups.append({"key": lens, "label": LENS_LABELS[lens], "findings": findings})
    return {"lenses": groups}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -v`
Expected: PASS (13 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/humanize.py packages/api/tests/generate/test_humanize.py
git commit -m "feat(humanize): response parser with verbatim target-locating + guardrail"
```

### Task B2: Report score + `analyze_humanize` (LLM entry)

**Files:**
- Modify: `packages/api/blogforge/generate/humanize.py`
- Test: `packages/api/tests/generate/test_humanize.py`

The human-signal sub-score: start at 100, dock per open finding but cap each lens's total dock so a Strong pass can't nuke the number (spec §Unified score).

- [ ] **Step 1: Write the failing test** (append)

```python
def test_score_full_when_no_findings():
    report = {"lenses": [{"key": "flow", "label": "Flow & Rhythm", "findings": []}]}
    assert humanize.score_report(report) == 100


def test_score_docks_but_caps_per_lens():
    many = [{"lens": "flow"} for _ in range(20)]
    report = {"lenses": [{"key": "flow", "label": "Flow & Rhythm", "findings": many}]}
    # 20 findings in one lens cannot dock more than the per-lens cap (15).
    assert humanize.score_report(report) == 85


import pytest


class _JsonLLM:
    name = "json"

    def __init__(self, text: str) -> None:
        self._text = text

    async def complete(self, **_kw):
        from blogforge.llm.base import LLMResponse
        return LLMResponse(text=self._text, input_tokens=1, output_tokens=1, model="m", finish_reason="stop")


def _fake_pack(tmp_path):
    (tmp_path / "stylepack.yaml").write_text(
        "spec: '1.0'\npersona: {identity: A, one_line: B}\n", encoding="utf-8"
    )
    (tmp_path / "style-guide.md").write_text("# guide\n", encoding="utf-8")
    return tmp_path


@pytest.mark.asyncio
async def test_analyze_humanize_light_only_runs_flow_and_soul(tmp_path):
    raw = '{"lenses": {"flow": [], "soul": [], "voice": [], "imperfections": []}}'
    report = await humanize.analyze_humanize(
        _draft(), _fake_pack(tmp_path), _JsonLLM(raw), intensity="light", model="m"
    )
    keys = [g["key"] for g in report["lenses"]]
    assert keys == ["flow", "soul"]
    assert report["intensity"] == "light"
    assert report["score"] == 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -k "score or analyze" -v`
Expected: FAIL — `AttributeError: ... 'score_report'` / `'analyze_humanize'`.

- [ ] **Step 3: Write minimal implementation** (add to `humanize.py`)

```python
from blogforge.llm.base import LLMProvider
from blogforge.voice import compose_prompt

_PER_LENS_CAP = 15  # max points one lens can dock from the human-signal sub-score
_DOCK_PER = 4

_DIRECTIVE = (
    "You are a line editor making prose read as written by a real person, not a "
    "model. Using the lens rubric above, find sentences that read as robotic and "
    "propose a rewrite for each. Only engage these lenses: {lenses}. For each "
    "finding return the section title (or \"opening\" for the lede), the verbatim "
    "target sentence copied exactly from the draft, a suggestion, and a one-line "
    "note. GUARDRAIL: change wording, rhythm, and stance only — never alter a "
    "number, name, quotation, or link, and never rewrite the opening answer "
    'sentence. Return JSON: {{"lenses": {{"<lens>": [{{"section": "", '
    '"target": "", "suggestion": "", "note": ""}}]}}}} with only the engaged lenses.'
)


def score_report(report: dict[str, Any]) -> int:
    total_dock = 0
    for group in report["lenses"]:
        total_dock += min(len(group["findings"]) * _DOCK_PER, _PER_LENS_CAP)
    return max(0, 100 - total_dock)


async def analyze_humanize(
    draft: Draft,
    pack_root: Path,
    provider: LLMProvider,
    *,
    intensity: Intensity,
    model: str,
) -> dict[str, Any]:
    engaged = lenses_for(intensity)
    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    rubric = load_rubric(pack_root)
    directive = _DIRECTIVE.format(lenses=", ".join(engaged))
    prompt = f"{system}\n\n---\n\n{rubric}\n\n{directive}\n\nDRAFT:\n{_draft_text(draft)}"
    resp = await provider.complete(model=model, prompt=prompt)
    report = parse_humanize(resp.text, draft, engaged)
    report["intensity"] = intensity
    report["score"] = score_report(report)
    return report


def _draft_text(draft: Draft) -> str:
    parts: list[str] = []
    if draft.outline and draft.outline.opening_hook:
        parts.append(draft.outline.opening_hook)
    for s in draft.sections:
        parts.append(f"## {s.title}\n{s.content_md}")
    return "\n\n".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && uv run pytest tests/generate/test_humanize.py -v`
Expected: PASS (16 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/humanize.py packages/api/tests/generate/test_humanize.py
git commit -m "feat(humanize): analyze_humanize LLM entry + capped human-signal score"
```

---

## Phase C — Backend API

### Task C1: `POST /api/drafts/{id}/humanize`

**Files:**
- Create: `packages/api/blogforge/api/humanize.py`
- Modify: `packages/api/blogforge/api/server.py` (import + include router)
- Test: `packages/api/tests/api/test_humanize_route.py`

Copy the loader/error idioms verbatim from `api/geo.py` (`_load`, `_provider_error`).

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/api/test_humanize_route.py`:

```python
import os

import pytest


@pytest.mark.asyncio
async def test_humanize_route_returns_report(authed_client, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    client, _user_id = authed_client
    # Create a draft with one composed section (mirror how other route tests seed a draft).
    draft = client.post("/api/drafts", json={"topic": "t", "provider": "claude-cli", "model": "opus"}).json()
    did = draft["id"]
    r = client.post(f"/api/drafts/{did}/humanize", json={"intensity": "light"})
    assert r.status_code == 200
    body = r.json()
    assert body["intensity"] == "light"
    assert [g["key"] for g in body["lenses"]] == ["flow", "soul"]
    assert isinstance(body["score"], int)


@pytest.mark.asyncio
async def test_humanize_route_rejects_bad_intensity(authed_client, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    client, _ = authed_client
    draft = client.post("/api/drafts", json={"topic": "t", "provider": "claude-cli", "model": "opus"}).json()
    r = client.post(f"/api/drafts/{draft['id']}/humanize", json={"intensity": "extreme"})
    assert r.status_code == 422
```

> If the existing route-test seed differs (check `tests/api/test_geo_route.py` or the nearest sibling for how it builds a draft the pass can run on), copy that draft-creation call exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && uv run pytest tests/api/test_humanize_route.py -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Write minimal implementation**

Create `packages/api/blogforge/api/humanize.py` (mirror `api/geo.py` header/`_load`/`_provider_error` exactly — import them if they are exported, else copy):

```python
"""Humanize pass endpoint — additive 'sound human' rewrites."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from blogforge.api.auth import get_current_user  # match geo.py's import
from blogforge.api.geo import _load, _provider_error  # reuse geo's loader + error mapper
from blogforge.generate.humanize import analyze_humanize
from blogforge.llm.errors import ProviderError, ProviderMissingKey  # match geo.py
from blogforge.models_user import User  # match geo.py's User import path
from blogforge.voice.compose import ComposeError

router = APIRouter(tags=["humanize"])


class _HumanizeBody(BaseModel):
    intensity: Literal["light", "medium", "strong"] = "medium"


@router.post("/api/drafts/{draft_id}/humanize")
async def humanize_report(
    draft_id: str,
    body: _HumanizeBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict[str, object]:
    draft, pack_root, _manifest, provider = await _load(request, draft_id, current)
    try:
        return await analyze_humanize(
            draft, pack_root, provider, intensity=body.intensity, model=draft.idea.model
        )
    except (ProviderMissingKey, ProviderError, ComposeError) as e:
        raise _provider_error(e) from e
```

> Before running, open `packages/api/blogforge/api/geo.py` lines 1-67 and copy its EXACT import paths for `get_current_user`, `User`, `ProviderError`, `ProviderMissingKey`, and confirm `_load`/`_provider_error` are module-level (they are, per geo.py:37-67). If they are underscore-private and linting forbids cross-module import, promote them to `load_draft_ctx`/`provider_error` in `geo.py` and import those.

- [ ] **Step 4: Register the router in `server.py`**

In `packages/api/blogforge/api/server.py`, next to the GEO import (~line 221) add:

```python
from blogforge.api.humanize import router as humanize_router
```

and next to `app.include_router(geo_router)` (~line 267) add:

```python
app.include_router(humanize_router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && uv run pytest tests/api/test_humanize_route.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Run the full backend suite**

Run: `cd packages/api && uv run pytest -q`
Expected: all pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add packages/api/blogforge/api/humanize.py packages/api/blogforge/api/server.py packages/api/tests/api/test_humanize_route.py
git commit -m "feat(humanize): POST /api/drafts/{id}/humanize endpoint"
```

---

## Phase D — Frontend plumbing: client, types, adapter, apply, dismissals, cache

### Task D1: Client + types (`api/humanize.ts`)

**Files:**
- Create: `packages/web/src/api/humanize.ts`

- [ ] **Step 1: Write the module** (no test — exercised via the rail test in E1)

Create `packages/web/src/api/humanize.ts` (mirror `api/geo.ts::analyzeGeo`):

```ts
import { api } from "./client";

export type Intensity = "light" | "medium" | "strong";

export interface HumanizeFinding {
  lens: string;
  section_id: string;
  target: string;
  suggestion: string;
  note: string;
  needs_review: boolean;
}
export interface HumanizeLens {
  key: string;
  label: string;
  findings: HumanizeFinding[];
}
export interface HumanizeReport {
  intensity: Intensity;
  score: number;
  lenses: HumanizeLens[];
}

export function analyzeHumanize(draftId: string, intensity: Intensity): Promise<HumanizeReport> {
  return api<HumanizeReport>(`/api/drafts/${encodeURIComponent(draftId)}/humanize`, {
    method: "POST",
    body: JSON.stringify({ intensity }),
  });
}
```

> Confirm `api<T>` sets `Content-Type: application/json` and stringifies bodies the way `api/geo.ts` calls do (check one POST-with-body in `api/drafts.ts`, e.g. `saveSection`, and match it).

- [ ] **Step 2: Type-check**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/humanize.ts
git commit -m "feat(humanize): api client + report types"
```

### Task D2: `Issue.panel` + `humanizeAdapter.ts`

**Files:**
- Modify: `packages/web/src/lib/issues/types.ts` (add `"humanize"` to `Issue.panel`)
- Create: `packages/web/src/lib/issues/humanizeAdapter.ts`
- Test: `packages/web/tests/lib/issues/humanizeAdapter.test.ts`

- [ ] **Step 1: Add `"humanize"` to the panel union**

In `packages/web/src/lib/issues/types.ts`, change:
```ts
panel: "geo" | "proofread";
```
to:
```ts
panel: "geo" | "proofread" | "humanize";
```

- [ ] **Step 2: Write the failing test**

Create `packages/web/tests/lib/issues/humanizeAdapter.test.ts` (model on `tests/lib/issues/proofreadAdapter.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { humanizeFindingsToIssues } from "../../../src/lib/issues/humanizeAdapter";
import type { HumanizeReport } from "../../../src/api/humanize";

const report: HumanizeReport = {
  intensity: "medium",
  score: 88,
  lenses: [
    {
      key: "soul",
      label: "De-robot / Soul",
      findings: [
        { lens: "soul", section_id: "s1", target: "The API serves as a gateway.",
          suggestion: "The API is the gateway.", note: "puffery", needs_review: false },
        { lens: "soul", section_id: "s2", target: "Freed 11 GB.",
          suggestion: "Freed 12 GB.", note: "loosen", needs_review: true },
      ],
    },
  ],
};

describe("humanizeFindingsToIssues", () => {
  it("maps findings to humanize-panel issues with target + actions", () => {
    const issues = humanizeFindingsToIssues(report);
    expect(issues).toHaveLength(2);
    expect(issues[0].panel).toBe("humanize");
    expect(issues[0].sectionId).toBe("s1");
    expect(issues[0].target).toBe("The API serves as a gateway.");
    expect(issues[0].lever).toBe("soul");
    expect(issues[0].actions).toContain("ai_fix");
    expect(issues[0].actions).toContain("dismiss");
  });

  it("marks needs_review findings so the UI can require confirm", () => {
    const issues = humanizeFindingsToIssues(report);
    expect(issues[1].nature).toBe("advisory"); // fact-changing -> not auto-apply
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/web && npm test -- humanizeAdapter`
Expected: FAIL — cannot find module `humanizeAdapter`.

- [ ] **Step 4: Write minimal implementation**

Create `packages/web/src/lib/issues/humanizeAdapter.ts` (model on `proofreadAdapter.ts`; use the real `Issue` field names from `types.ts`):

```ts
import type { HumanizeReport } from "../../api/humanize";
import type { Issue } from "./types";

export function humanizeFindingsToIssues(report: HumanizeReport): Issue[] {
  const issues: Issue[] = [];
  for (const lens of report.lenses) {
    lens.findings.forEach((f, i) => {
      issues.push({
        id: `humanize:${f.lens}:${f.section_id}:${i}`,
        panel: "humanize",
        lever: f.lens,
        title: f.note || "Reads robotic",
        why: f.note,
        nature: f.needs_review ? "advisory" : "fix",
        sectionId: f.section_id,
        target: f.target,
        fixKind: "humanize_rewrite",
        // carry the precomputed rewrite so apply needs no model call
        suggestion: f.suggestion,
        actions: ["ai_fix", "manual_fix", "highlight", "dismiss"],
        status: "open",
      } as Issue);
    });
  }
  return issues;
}
```

> `Issue` may not have a `suggestion` field today. Add an optional `suggestion?: string` to the `Issue` interface in `types.ts` (used only by humanize apply). If `IssueAction`/`IssueNature` reject any value above, open `types.ts` and use the exact allowed literals (`ai_fix|manual_fix|highlight|dismiss` and `fix|add|advisory` per the extraction).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/web && npm test -- humanizeAdapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/issues/types.ts packages/web/src/lib/issues/humanizeAdapter.ts packages/web/tests/lib/issues/humanizeAdapter.test.ts
git commit -m "feat(humanize): issue adapter + suggestion field"
```

### Task D3: Apply (`humanizeApply.ts`)

**Files:**
- Create: `packages/web/src/lib/issues/humanizeApply.ts`
- Test: `packages/web/tests/lib/issues/humanizeApply.test.ts`

Study `lib/issues/proofreadApply.ts` / `geoApply.ts` first to match the `makeGeoApply`/`makeGeoSave` call shape `useIssueLifecycle` expects.

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/lib/issues/humanizeApply.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeHumanizeSave } from "../../../src/lib/issues/humanizeApply";

describe("makeHumanizeSave", () => {
  it("replaces the target with the suggestion and saves the section", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const draft: any = { sections: [{ id: "s1", content_md: "The API serves as a gateway. It adds 5ms." }] };
    const save = makeHumanizeSave(draft, onSectionSave);
    await save({ sectionId: "s1", target: "The API serves as a gateway.", suggestion: "The API is the gateway." } as any);
    expect(onSectionSave).toHaveBeenCalledWith("s1", "The API is the gateway. It adds 5ms.", true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npm test -- humanizeApply`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/issues/humanizeApply.ts`:

```ts
import type { Draft } from "../../api/drafts";
import type { Issue } from "./types";

type SectionSave = (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;

/** Apply a humanize issue: swap its precomputed suggestion in for the target
 * span in the section's content_md and persist. No model call. */
export function makeHumanizeSave(draft: Draft, onSectionSave: SectionSave) {
  return async (issue: Pick<Issue, "sectionId" | "target" | "suggestion">): Promise<void> => {
    if (!issue.target || !issue.suggestion) return;
    const section = draft.sections.find((s) => s.id === issue.sectionId);
    if (!section) return;
    const next = section.content_md.replace(issue.target, issue.suggestion);
    await onSectionSave(issue.sectionId, next, true);
  };
}
```

> If `useIssueLifecycle` expects an `apply` function that returns the previewed text (like `makeGeoApply`), also export `makeHumanizeApply` that returns `issue.suggestion` (the preview is already computed — no fetch). Match the exact signature `GeoReviewRail` passes at its `makeGeoApply(...)` call site.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npm test -- humanizeApply`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/issues/humanizeApply.ts packages/web/tests/lib/issues/humanizeApply.test.ts
git commit -m "feat(humanize): client-side apply (target->suggestion, no model call)"
```

### Task D4: Dismissals (`humanizeDismissals.ts`)

**Files:**
- Create: `packages/web/src/lib/humanizeDismissals.ts`
- Test: `packages/web/tests/lib/humanizeDismissals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/lib/humanizeDismissals.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { dismiss, loadDismissed, restore } from "../../src/lib/humanizeDismissals";

describe("humanizeDismissals", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips dismiss/restore per draft", () => {
    expect(loadDismissed("d1").size).toBe(0);
    dismiss("d1", "issue-a");
    expect(loadDismissed("d1").has("issue-a")).toBe(true);
    restore("d1", "issue-a");
    expect(loadDismissed("d1").has("issue-a")).toBe(false);
  });

  it("keys are per-draft", () => {
    dismiss("d1", "x");
    expect(loadDismissed("d2").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npm test -- humanizeDismissals`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (copy `lib/lintDismissals.ts`, swap the key prefix)

Create `packages/web/src/lib/humanizeDismissals.ts`:

```ts
const KEY = (draftId: string): string => `bf.humanize.dismissed.${draftId}`;

export function loadDismissed(draftId: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY(draftId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(draftId: string, ids: Set<string>): void {
  localStorage.setItem(KEY(draftId), JSON.stringify([...ids]));
}

export function dismiss(draftId: string, findingId: string): Set<string> {
  const ids = loadDismissed(draftId);
  ids.add(findingId);
  save(draftId, ids);
  return ids;
}

export function restore(draftId: string, findingId: string): Set<string> {
  const ids = loadDismissed(draftId);
  ids.delete(findingId);
  save(draftId, ids);
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npm test -- humanizeDismissals`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/humanizeDismissals.ts packages/web/tests/lib/humanizeDismissals.test.ts
git commit -m "feat(humanize): per-draft dismissals (localStorage)"
```

### Task D5: Add `"humanize"` to `PanelKind`

**Files:**
- Modify: `packages/web/src/lib/panelCache.ts`

- [ ] **Step 1: Edit the union**

In `packages/web/src/lib/panelCache.ts`, change:
```ts
export type PanelKind = "geo" | "shape";
```
to:
```ts
export type PanelKind = "geo" | "shape" | "humanize";
```

- [ ] **Step 2: Type-check + commit**

Run: `cd packages/web && npx tsc --noEmit` → no errors.

```bash
git add packages/web/src/lib/panelCache.ts
git commit -m "feat(humanize): allow humanize reports in panelCache"
```

---

## Phase E — Frontend UI: rail, panel, menu wiring

### Task E1: `HumanizeReviewRail.tsx`

**Files:**
- Create: `packages/web/src/components/draft/HumanizeReviewRail.tsx`
- Test: `packages/web/tests/components/HumanizeReviewRail.test.tsx`

Model this file on `ProofreadReviewRail.tsx` (the minimal rail): it takes a report, runs it through `humanizeFindingsToIssues`, filters dismissed ids, groups by lens label, and renders each `Issue` with `<IssueCard>` driven by `useIssueLifecycle` wired to `makeHumanizeSave`/`makeHumanizeApply` and the humanize dismissals.

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/components/HumanizeReviewRail.test.tsx` (model on `tests/components/ProofreadReviewRail.test.tsx`):

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HumanizeReviewRail } from "../../src/components/draft/HumanizeReviewRail";
import type { HumanizeReport } from "../../src/api/humanize";

const report: HumanizeReport = {
  intensity: "medium", score: 88,
  lenses: [{ key: "soul", label: "De-robot / Soul", findings: [
    { lens: "soul", section_id: "s1", target: "The API serves as a gateway.",
      suggestion: "The API is the gateway.", note: "puffery", needs_review: false },
  ]}],
};
const draft: any = { id: "d1", sections: [{ id: "s1", title: "S", content_md: "The API serves as a gateway." }] };

describe("HumanizeReviewRail", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it("renders lens groups and findings", () => {
    render(<HumanizeReviewRail report={report} draft={draft}
      onSectionSave={vi.fn().mockResolvedValue(undefined)} onHighlight={vi.fn()} />);
    expect(screen.getByText("De-robot / Soul")).toBeInTheDocument();
    expect(screen.getByText(/puffery/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npm test -- HumanizeReviewRail`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Open `packages/web/src/components/draft/ProofreadReviewRail.tsx` and copy its structure. Create `HumanizeReviewRail.tsx` with props `{ report: HumanizeReport; draft: Draft; onSectionSave; onHighlight? }`, computing `const issues = humanizeFindingsToIssues(report)` then filtering `loadDismissed(draft.id)`, grouping by `lens.label`, and rendering `<IssueCard>` per issue via `useIssueLifecycle` (wire `apply` → `makeHumanizeApply`, `save` → `makeHumanizeSave(draft, onSectionSave)`, `dismiss` → `humanizeDismissals.dismiss`). Reuse the exact `IssueCard`/`useIssueLifecycle` props the `ProofreadReviewRail` passes. (No new inline endpoint — apply is local.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npm test -- HumanizeReviewRail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/draft/HumanizeReviewRail.tsx packages/web/tests/components/HumanizeReviewRail.test.tsx
git commit -m "feat(humanize): review rail on the shared Issue pipeline"
```

### Task E2: `HumanizePanel.tsx` (slide-in + dial + cache)

**Files:**
- Create: `packages/web/src/components/draft/HumanizePanel.tsx`
- Test: `packages/web/tests/components/HumanizePanel.test.tsx`

Model the shell on `LintPanel.tsx` (slide-in) and the analyze-on-open + cache logic on `OptimizePanel.tsx:120-145`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/humanize", () => ({
  analyzeHumanize: vi.fn().mockResolvedValue({
    intensity: "medium", score: 90,
    lenses: [{ key: "flow", label: "Flow & Rhythm", findings: [] }],
  }),
}));
import { analyzeHumanize } from "../../src/api/humanize";
import { HumanizePanel } from "../../src/components/draft/HumanizePanel";

const draft: any = { id: "d1", title: "T", sections: [{ id: "s1", title: "S", content_md: "x" }], outline: { opening_hook: "h" } };

describe("HumanizePanel", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it("runs the pass on open and shows the intensity dial", async () => {
    render(<HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "medium"));
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /strong/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npm test -- HumanizePanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `HumanizePanel.tsx`: a slide-in (copy `LintPanel`'s shell/close). On open and on dial change, read the persisted report via `peekCached<HumanizeReport>("humanize", draft.id, hashDraftContent(draft))`; if the cache misses OR the intensity differs, call `analyzeHumanize(draft.id, intensity)` and `setCached("humanize", draft.id, hash, report)`. Persist the selected intensity in `localStorage` under `bf.humanize.intensity.${draft.id}` (default `"medium"`). Header contains a 3-button segmented control (Light/Medium/Strong) and the `HumanityRing` (reused) showing `report.score`. Body renders `<HumanizeReviewRail report draft onSectionSave onHighlight />`.

> Cache subtlety: the report is intensity-specific. Include intensity in the cache identity — either cache under a composite key by adding intensity to the hash input, or store `{intensity, report}` and re-run when the stored intensity differs from the selected one. Pick the composite-key approach (simplest): `setCached("humanize", draft.id, `${hash}:${intensity}`, report)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npm test -- HumanizePanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/draft/HumanizePanel.tsx packages/web/tests/components/HumanizePanel.test.tsx
git commit -m "feat(humanize): panel with intensity dial + cached analyze-on-open"
```

### Task E3: Wire into the Improve menu

**Files:**
- Modify: `packages/web/src/components/draft/WorkspaceFooter.tsx` (add menu item + prop)
- Modify: `packages/web/src/components/draft/DraftWorkspace.tsx` (state + handler + mount)

- [ ] **Step 1: Add the prop + menu item in `WorkspaceFooter.tsx`**

Add `onHumanize: () => void;` to `WorkspaceFooterProps` (the interface at lines ~13-18). Add to the `improveItems` array (after the Shape entry):

```ts
{ label: "🫶 Humanize", hint: "Make it read like a person wrote it", onClick: onHumanize },
```

- [ ] **Step 2: Wire state + mount in `DraftWorkspace.tsx`**

Add `const [humanizeOpen, setHumanizeOpen] = useState(false);` next to `shapeOpen`/`geoOpen` (~lines 64-69). Pass `onHumanize={() => setHumanizeOpen(true)}` to `<WorkspaceFooter ... />` (~lines 496-507). Mount alongside the other panels (~lines 510-567):

```tsx
{humanizeOpen && (
  <HumanizePanel
    draft={draft}
    onSectionSave={handleSectionSave}
    onClose={() => setHumanizeOpen(false)}
  />
)}
```

Use the SAME `onSectionSave`/save handler `OptimizePanel` is given (copy that prop name from the `{geoOpen && <OptimizePanel .../>}` mount). Add the import: `import { HumanizePanel } from "./HumanizePanel";`.

- [ ] **Step 3: Type-check + run the draft component suite**

Run: `cd packages/web && npx tsc --noEmit && npm test -- DraftWorkspace WorkspaceFooter`
Expected: no type errors; existing tests pass. If `WorkspaceFooter` has a test asserting the item count, update it to include Humanize.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/draft/WorkspaceFooter.tsx packages/web/src/components/draft/DraftWorkspace.tsx
git commit -m "feat(humanize): add Humanize to the Improve menu"
```

---

## Phase F — Unify the score

### Task F1: Blend the human-signal sub-score into `checkup.ts`

**Files:**
- Modify: `packages/web/src/lib/checkup.ts`
- Test: `packages/web/tests/lib/checkup.test.ts`

Per spec §Unified score: `humanness = humanSignalSub == null ? antiRobotSub : round(0.5*antiRobotSub + 0.5*humanSignalSub)`. The Humanize report already carries `score` (the capped human-signal sub-score from Task B2), so the frontend just blends.

- [ ] **Step 1: Write the failing test** (append to `tests/lib/checkup.test.ts`)

```ts
import { blendHumanness } from "../../src/lib/checkup";

describe("blendHumanness", () => {
  it("returns the anti-robot score when Humanize has not run", () => {
    expect(blendHumanness(80, null)).toBe(80);
  });
  it("averages the two sub-scores 50/50 when both present", () => {
    expect(blendHumanness(80, 60)).toBe(70);
  });
  it("clamps to 0..100", () => {
    expect(blendHumanness(0, 0)).toBe(0);
    expect(blendHumanness(100, 100)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npm test -- checkup`
Expected: FAIL — `blendHumanness` is not exported.

- [ ] **Step 3: Write minimal implementation** (add to `checkup.ts`)

```ts
const W_ROBOT = 0.5;
const W_HUMAN = 0.5;

/** One "Reads X% human" number from the anti-robot lint sub-score and the
 * (optional, until Humanize has run) human-signal sub-score. */
export function blendHumanness(antiRobot: number, humanSignal: number | null): number {
  if (humanSignal == null) return Math.max(0, Math.min(100, Math.round(antiRobot)));
  return Math.max(0, Math.min(100, Math.round(W_ROBOT * antiRobot + W_HUMAN * humanSignal)));
}
```

- [ ] **Step 4: Extend `summarizeCheckup` + `CheckupKey`**

Change `CheckupKey` to `"review" | "geo" | "shape" | "humanize"`. Update `summarizeCheckup(lint, geo, shape, humanize)` to accept a 4th arg (a `HumanizeReport | null`), push a 4th `CheckupRow` (`key: "humanize"`, `label: "Humanness"`, `count: total findings`, severity from `humanize.score`), and set `humanity = blendHumanness(humanityScore(reviewOpen, hits), humanize ? humanize.score : null)`.

Add a test asserting the 4-arg `summarizeCheckup` yields a `humanize` row and a blended `humanity`. (Model on the existing `summarizeCheckup` test in the file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/web && npm test -- checkup`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/checkup.ts packages/web/tests/lib/checkup.test.ts
git commit -m "feat(humanize): blend human-signal into the unified humanness score"
```

### Task F2: Fan Humanize into `CheckupPanel.tsx`

**Files:**
- Modify: `packages/web/src/components/draft/CheckupPanel.tsx`

- [ ] **Step 1: Add the loader + 4th settled result**

In `CheckupPanel.tsx`, next to `loadGeo`/`loadShape` (lines ~46-78) add:

```ts
const loadHumanize = async (): Promise<HumanizeReport> => {
  const key = `${hash}:medium`;
  const hit = getCached<HumanizeReport>("humanize", draft.id, key);
  if (hit) return hit.data;
  const fresh = await analyzeHumanize(draft.id, "medium");
  setCached("humanize", draft.id, key, fresh);
  return fresh;
};
```

Extend the `Promise.allSettled([...])` to include `loadHumanize()` and pass its fulfilled value as the 4th arg to `summarizeCheckup(...)`. Add `onOpenHumanize?: () => void` to the panel props and route the `humanize` row's action to it (mirror `onOpenGeo`). Import `analyzeHumanize`, `HumanizeReport`.

> Checkup runs Humanize at a fixed `"medium"` (its summary view), independent of the panel's dial — document this in a code comment. The full dial lives in `HumanizePanel`.

- [ ] **Step 2: Wire `onOpenHumanize` from `DraftWorkspace.tsx`**

Where `<CheckupPanel ... onOpenGeo={() => { setCheckupOpen(false); setGeoOpen(true); }} />` is mounted, add `onOpenHumanize={() => { setCheckupOpen(false); setHumanizeOpen(true); }}`.

- [ ] **Step 3: Type-check + run**

Run: `cd packages/web && npx tsc --noEmit && npm test -- CheckupPanel checkup`
Expected: no type errors; tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/draft/CheckupPanel.tsx packages/web/src/components/draft/DraftWorkspace.tsx
git commit -m "feat(humanize): Humanness row + blended score in Checkup"
```

---

## Phase G — Full verification

### Task G1: Whole-suite green + manual smoke

- [ ] **Step 1: Backend suite**

Run: `cd packages/api && uv run pytest -q`
Expected: all pass.

- [ ] **Step 2: Frontend suite + typecheck + lint**

Run: `cd packages/web && npx tsc --noEmit && npm test && npx biome check src`
Expected: all pass / no errors.

- [ ] **Step 3: Manual smoke (real app)**

Run the app (per `docs`/CLAUDE memory: rebuild static, scrub `ANTHROPIC_*`/`CLAUDE_*` env, app on :7880), open the existing draft, `Improve ▾ → 🫶 Humanize`. Verify: the pass runs, 4 lens groups appear at Strong / 2 at Light, an AI-fix Accept rewrites the sentence in the section, a `needs_review` finding requires confirm, and Checkup shows a "Humanness" row with a blended "Reads X% human".

- [ ] **Step 4: Commit any smoke fixes, then stop for review.**

```bash
git add -A && git commit -m "test(humanize): whole-suite green + smoke fixes"
```

---

## Notes for the implementer
- **Verbatim targets are load-bearing.** The parser drops any finding whose `target` isn't found verbatim in its section, and apply does a `String.replace(target, suggestion)`. If the model paraphrases the target, the finding is silently skipped — that's intended (better to skip than mis-apply). The prompt says "copied exactly."
- **Do not touch generation.** No edits to `compose.py`, `section.j2`, `enforce.py`. Humanize is purely on-demand.
- **Reuse, don't fork.** `IssueCard`, `useIssueLifecycle`, `HighlightedText`, `HumanityRing` are panel-agnostic — import them, don't reimplement.
- **Match real signatures.** Before writing each frontend file, open the sibling it mirrors (`proofreadAdapter.ts`, `ProofreadReviewRail.tsx`, `geoApply.ts`, `LintPanel.tsx`) and copy prop names/lifecycle wiring exactly; the extraction above gives the shapes but the sibling is the source of truth.
