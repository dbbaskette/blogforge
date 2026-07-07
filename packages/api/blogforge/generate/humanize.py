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
