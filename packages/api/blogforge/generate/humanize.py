"""On-demand Humanize pass — additive 'sound human' rewrites, complementing
the subtractive anti-AI-tells Humanizer. Mirrors generate/geo.py."""
from __future__ import annotations

import re
from functools import lru_cache
from importlib import resources
from pathlib import Path
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
