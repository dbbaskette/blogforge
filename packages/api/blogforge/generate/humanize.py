"""On-demand Humanize pass — additive 'sound human' rewrites, complementing
the subtractive anti-AI-tells Humanizer. Mirrors generate/geo.py."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.generate.textutil import strip_inline_emphasis
from blogforge.llm.base import LLMProvider
from blogforge.voice import compose_prompt

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


def _key(title: str) -> str:
    # Strip inline markdown emphasis before matching (mirrors geo.py::parse_semantic)
    # so a stored "**The Setup**" still resolves when the model returns "The Setup".
    return " ".join(strip_inline_emphasis(title).lower().split())


def _section_text(draft: Draft, sid: str) -> str:
    if sid == "opening":
        return draft.outline.opening_hook if draft.outline else ""
    for s in draft.sections:
        if s.id == sid:
            return s.content_md
    return ""


def parse_humanize(raw: str, draft: Draft, engaged: tuple[Lens, ...]) -> dict[str, Any]:
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
            findings.append(
                {
                    "lens": lens,
                    "section_id": sid,
                    "target": target,
                    "suggestion": suggestion,
                    "note": str(item.get("note", "")).strip(),
                    "needs_review": needs_review(target, suggestion),
                }
            )
        groups.append({"key": lens, "label": LENS_LABELS[lens], "findings": findings})
    return {"lenses": groups}


_PER_LENS_CAP = 15  # max points one lens can dock from the human-signal sub-score
_DOCK_PER = 4

_DIRECTIVE = (
    "You are a line editor making prose read as written by a real person, not a "
    "model. Using the lens rubric above, find sentences that read as robotic and "
    "propose a rewrite for each. Only engage these lenses: {lenses}. For each "
    'finding return the section title (or "opening" for the lede), the verbatim '
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
