"""blogforge.voice — the style-pack engine absorbed from the myvoice project
(github.com/dbbaskette/myvoice, same author, MIT). BlogForge vendors the used
slice (compose / lint / validate / packs) so it has no external dependency."""
from __future__ import annotations

from blogforge.voice.compose import ComposeError, compose as compose_prompt
from blogforge.voice.lint import (
    LintHit,
    Violation,
    detect_ai_patterns,
    detect_positive_hits,
    lint,
    lint_to_hits,
)
from blogforge.voice.packs.manifest import Manifest
from blogforge.voice.packs.store import PackStore
from blogforge.voice.validate import validate_pack

__all__ = [
    "ComposeError", "LintHit", "Manifest", "PackStore", "Violation",
    "compose_prompt", "detect_ai_patterns", "detect_positive_hits",
    "lint", "lint_to_hits", "validate_pack",
]
