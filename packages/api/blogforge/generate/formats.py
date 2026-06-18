"""Resolve a draft's requested format against the *active* voice's manifest.

A draft carries a `format` (e.g. "blog-post"), but the voice it generates with
may not define it — most notably a materialized voice profile, whose manifest
carries `formats: []`. Composing with an unknown format raises deep in myvoice
(HTTP 422). Generation should instead fall back to no named format: write in the
voice without the format-specific block, rather than fail.
"""
from __future__ import annotations

from pathlib import Path

import yaml


def resolve_format(pack_root: Path, requested: str | None) -> str | None:
    """Return `requested` only if `pack_root`'s manifest defines that format;
    otherwise None (compose without a format block instead of crashing)."""
    if not requested:
        return None
    try:
        manifest = yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return None
    names = {
        f.get("name")
        for f in (manifest.get("formats") or [])
        if isinstance(f, dict)
    }
    return requested if requested in names else None
