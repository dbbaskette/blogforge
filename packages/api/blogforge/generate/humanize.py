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
