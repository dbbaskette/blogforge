"""Discover style packs by walking directories one level deep."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from blogforge.voice.validate import ValidationError, validate_pack


@dataclass(frozen=True)
class PackInfo:
    slug: str
    name: str
    version: str
    root_path: Path
    valid: bool
    errors: list[ValidationError] = field(default_factory=list)


def discover_packs(roots: list[Path]) -> list[PackInfo]:
    """Walk each root one level deep, return all discovered packs.

    A pack is any subdirectory that contains a `stylepack.yaml`. The pack's
    slug is taken from its parsed manifest if possible, otherwise from its
    directory name (so we can still surface invalid packs to the UI).

    Results are returned in `roots` order. Slug conflicts across roots are
    preserved (both entries returned) so the caller can warn.
    """
    found: list[PackInfo] = []
    for root in roots:
        if not root.is_dir():
            continue
        for entry in sorted(root.iterdir()):
            if not entry.is_dir():
                continue
            manifest = entry / "stylepack.yaml"
            if not manifest.is_file():
                continue
            result = validate_pack(entry)
            if result.manifest is not None:
                slug = result.manifest.pack.slug
                name = result.manifest.pack.name
                version = result.manifest.pack.version
            else:
                slug = entry.name
                name = entry.name
                version = "?"
            found.append(PackInfo(
                slug=slug,
                name=name,
                version=version,
                root_path=entry,
                valid=result.valid,
                errors=list(result.errors),
            ))
    return found
