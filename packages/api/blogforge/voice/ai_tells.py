"""Shared, bundled AI-writing tells.

Universal banished words/phrases/sentence-starters plus structural-pattern
prose, merged with a pack's own manifest rules. The lists are deduped unions
(shared first, then per-pack extras) keyed case-insensitively.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

from blogforge.voice.packs.manifest import Manifest


@dataclass(frozen=True)
class AiTells:
    words: tuple[str, ...]
    phrases: tuple[str, ...]
    sentence_starters: tuple[str, ...]
    patterns: str


def _read_lines(name: str) -> tuple[str, ...]:
    raw = (
        resources.files("blogforge.voice")
        .joinpath(f"assets/ai-tells/{name}")
        .read_text(encoding="utf-8")
    )
    out: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            out.append(stripped)
    return tuple(out)


@lru_cache(maxsize=1)
def load_ai_tells() -> AiTells:
    return AiTells(
        words=_read_lines("words.txt"),
        phrases=_read_lines("phrases.txt"),
        sentence_starters=_read_lines("sentence-starters.txt"),
        patterns=(
            resources.files("blogforge.voice")
            .joinpath("assets/ai-tells/patterns.md")
            .read_text(encoding="utf-8")
        ),
    )


def _dedup_ci(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        key = it.lower()
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out


def effective_words(m: Manifest) -> list[str]:
    return _dedup_ci([*load_ai_tells().words, *m.banished.words])


def effective_phrases(m: Manifest) -> list[str]:
    return _dedup_ci([*load_ai_tells().phrases, *m.banished.phrases])


def effective_sentence_starters(m: Manifest) -> list[str]:
    return _dedup_ci([*load_ai_tells().sentence_starters, *m.rules.no_sentence_starters])


_PATTERN_BULLET = re.compile(r"^- \*\*(.+?)\*\*\s*(.*)$")


def parsed_patterns() -> list[dict[str, str]]:
    """patterns.md bullets as {title, body} for the help page."""
    out = []
    for line in load_ai_tells().patterns.splitlines():
        m = _PATTERN_BULLET.match(line.strip())
        if m:
            out.append({"title": m.group(1).rstrip("."), "body": m.group(2).strip()})
    return out
