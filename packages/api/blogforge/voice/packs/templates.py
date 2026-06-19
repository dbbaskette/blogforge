"""Locate the bundled `_template` pack on disk."""
from __future__ import annotations

import os
from pathlib import Path


def _candidate_template_paths() -> list[Path]:
    """Ordered list of places `_template` might live."""
    here = Path(__file__).resolve()
    candidates: list[Path] = []
    # Bundled inside the package and shipped in the wheel:
    # packages/api/myvoice/packs/templates.py → parents[1] = .../myvoice
    # → .../myvoice/bundled_packs/_template. Works in dev and installed modes.
    candidates.append(here.parents[1] / "bundled_packs" / "_template")
    # Sibling of MYVOICE_PACKS_ROOT (if a user explicitly stages their own template).
    env_root = os.environ.get("MYVOICE_PACKS_ROOT")
    if env_root:
        candidates.append(Path(env_root) / "_template")
    return candidates


def locate_template() -> Path:
    """Return the path to the bundled `_template` pack, or raise FileNotFoundError."""
    for candidate in _candidate_template_paths():
        if (candidate / "stylepack.yaml").is_file():
            return candidate
    raise FileNotFoundError(
        "Could not find bundled _template pack. Checked: "
        + ", ".join(str(p) for p in _candidate_template_paths())
    )


def resolve_write_root() -> Path:
    """Where to create new packs. MYVOICE_PACKS_ROOT if set, else ~/.myvoice/packs/."""
    env = os.environ.get("MYVOICE_PACKS_ROOT")
    if env:
        return Path(env)
    return Path.home() / ".myvoice" / "packs"


def resolve_trash_root() -> Path:
    """Where soft-deleted packs go.

    Uses ``<MYVOICE_PACKS_ROOT_parent>/trash`` if env var set, else ``~/.myvoice/trash/``.
    """
    env = os.environ.get("MYVOICE_PACKS_ROOT")
    if env:
        return Path(env).parent / "trash"
    return Path.home() / ".myvoice" / "trash"
