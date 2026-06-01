"""Structural repetition analysis over a generated draft.

The per-rule style linter (myvoice) checks sentences in isolation, so it
can't see that section three opens the same way as section one, or that
"Avengers-level threat" shows up four times across the piece. Section-by-
section generation makes this the single most common failure mode: each
section is prompted with the same outline and voice, so the model keeps
reaching for the same stock phrases and the same "for years, we traded…"
opener.

This module looks at the whole draft at once and flags three things:

  * duplicate-paragraph — a paragraph reproduced near-verbatim elsewhere
    (e.g. the opening hook pasted back as the first paragraph of section one)
  * repeated-phrase — a distinctive multi-word phrase reused across two or
    more sections
  * echoed-opener — a section that opens with nearly the same words as an
    earlier section

Findings are dicts shaped like myvoice lint items ({rule, message, text})
so they render in the existing Proofreader panel with no UI special-casing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from blogforge.drafts.models import Draft

# --- tunables -------------------------------------------------------------
# Shortest repeated phrase we report. Two words catches "paved road"; we lean
# on the stopword filter below to keep "of the" out.
_MIN_PHRASE_WORDS = 2
# Recycled chunks longer than this are truncated with an ellipsis for display
# (the full phrase is still used for de-duplication).
_MAX_PHRASE_DISPLAY_WORDS = 12
# Two paragraphs at or above this similarity ratio are treated as duplicates.
_PARAGRAPH_SIMILARITY = 0.85
# Only consider paragraphs of at least this many words for duplicate detection
# (one-line transitions legitimately repeat).
_MIN_PARAGRAPH_WORDS = 12
# How many leading words define a section's "opener", and how similar two
# openers must be to count as an echo.
_OPENER_WORDS = 8
_OPENER_SIMILARITY = 0.7
# Safety cap so a pathological draft can't flood the panel.
_MAX_PHRASE_FINDINGS = 25

_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'\-]*")

# Function words that don't make a phrase distinctive on their own. A phrase
# built entirely from these (e.g. "of the", "and we make sure") is noise.
_STOPWORDS = frozenset(
    """
    a an the this that these those and or but so for nor yet of to in on at by
    with from as is are was were be been being am it its it's he she they we you
    i me my your our their his her them us do does did has have had will would
    can could should may might must not no than then there here about into over
    out up down off again very just also more most some any all each every which
    who whom whose what when where why how if because while though although
    """.split()
)


@dataclass
class _Block:
    """A titled span of draft text we analyze (the opening hook, or a section)."""

    label: str
    text: str
    tokens: list[str]


@dataclass
class Finding:
    rule: str
    message: str
    text: str

    def as_dict(self) -> dict[str, object]:
        return {"rule": self.rule, "message": self.message, "text": self.text}


def _strip_md(text: str) -> str:
    """Drop markdown punctuation so tokenizing sees words, not syntax."""
    text = re.sub(r"`[^`]*`", " ", text)  # inline code
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links/images → label
    text = re.sub(r"[#>*_~`\[\]()]", " ", text)
    return text


def _tokenize(text: str) -> list[str]:
    return [m.group(0).lower() for m in _WORD_RE.finditer(_strip_md(text))]


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _norm(text: str) -> str:
    return " ".join(_tokenize(text))


def _blocks(draft: Draft) -> list[_Block]:
    blocks: list[_Block] = []
    if draft.outline and draft.outline.opening_hook.strip():
        hook = draft.outline.opening_hook.strip()
        blocks.append(_Block("Opening hook", hook, _tokenize(hook)))
    for section in draft.sections:
        body = section.content_md.strip()
        if body:
            blocks.append(_Block(section.title or "Untitled section", body, _tokenize(body)))
    return blocks


def _all_stopwords(words: tuple[str, ...]) -> bool:
    return all(w in _STOPWORDS for w in words)


def _count_occurrences(tokens: list[str], gram: tuple[str, ...]) -> int:
    n = len(gram)
    return sum(1 for i in range(len(tokens) - n + 1) if tuple(tokens[i : i + n]) == gram)


def _detect_repeated_phrases(blocks: list[_Block], covered: list[str]) -> list[Finding]:
    """Find distinctive phrases reused across two or more blocks.

    Uses difflib to pull the *maximal* contiguous token runs shared by each
    pair of blocks, so a recycled sentence surfaces as one finding rather than
    a swarm of overlapping n-grams. Phrases already inside a flagged duplicate
    paragraph (``covered``) are suppressed, as is any phrase contained in a
    longer one already reported.
    """
    # 1) Collect maximal shared runs between every pair of blocks.
    candidates: set[tuple[str, ...]] = set()
    for i in range(len(blocks)):
        for j in range(i + 1, len(blocks)):
            matcher = SequenceMatcher(None, blocks[i].tokens, blocks[j].tokens, autojunk=False)
            for a, _b, size in matcher.get_matching_blocks():
                if size < _MIN_PHRASE_WORDS:
                    continue
                gram = tuple(blocks[i].tokens[a : a + size])
                if not _all_stopwords(gram):
                    candidates.add(gram)

    # 2) Count occurrences of each candidate across all blocks; keep only those
    #    that genuinely span ≥2 sections.
    scored: list[tuple[tuple[str, ...], dict[str, int]]] = []
    for gram in candidates:
        per_block = {
            b.label: c for b in blocks if (c := _count_occurrences(b.tokens, gram))
        }
        if len(per_block) >= 2:
            scored.append((gram, per_block))

    # 3) Longest-first so containment de-dup keeps the fullest phrase.
    scored.sort(key=lambda gp: (-len(gp[0]), -sum(gp[1].values())))
    findings: list[Finding] = []
    reported: list[str] = []  # space-padded phrases already accounted for
    for gram, per_block in scored:
        phrase = " ".join(gram)
        padded = f" {phrase} "
        if any(padded in r for r in reported):  # sub-phrase of a longer hit
            continue
        reported.append(padded)
        if any(phrase in c for c in covered):  # already a duplicate-paragraph
            continue
        total = sum(per_block.values())
        where = ", ".join(sorted(per_block))
        words = gram[:_MAX_PHRASE_DISPLAY_WORDS]
        shown = " ".join(words) + ("…" if len(gram) > _MAX_PHRASE_DISPLAY_WORDS else "")
        findings.append(
            Finding(
                rule="repeated-phrase",
                message=f'"{shown}" appears {total}× across {len(per_block)} sections ({where}).',
                text=shown,
            )
        )
        if len(findings) >= _MAX_PHRASE_FINDINGS:
            break
    return findings


def _detect_duplicate_paragraphs(blocks: list[_Block]) -> tuple[list[Finding], list[str]]:
    """Flag substantial paragraphs reproduced near-verbatim in another block.

    Returns ``(findings, covered)`` where ``covered`` is the normalized text of
    each flagged paragraph, so the phrase detector can suppress phrases that are
    merely fragments of an already-reported duplicate.
    """
    paras: list[tuple[str, str, str]] = []  # (block label, raw, normalized)
    for block in blocks:
        for raw in _paragraphs(block.text):
            norm = _norm(raw)
            if len(norm.split()) >= _MIN_PARAGRAPH_WORDS:
                paras.append((block.label, raw, norm))

    findings: list[Finding] = []
    covered: list[str] = []
    seen_pairs: set[frozenset[int]] = set()
    for a in range(len(paras)):
        for b in range(a + 1, len(paras)):
            if paras[a][0] == paras[b][0]:  # same block — within-section repeats are fine
                continue
            if frozenset((a, b)) in seen_pairs:
                continue
            ratio = SequenceMatcher(None, paras[a][2], paras[b][2]).ratio()
            if ratio >= _PARAGRAPH_SIMILARITY:
                seen_pairs.add(frozenset((a, b)))
                covered.extend((paras[a][2], paras[b][2]))
                snippet = " ".join(paras[a][1].split()[:14])
                verbatim = "verbatim" if ratio >= 0.99 else f"{round(ratio * 100)}% identical"
                findings.append(
                    Finding(
                        rule="duplicate-paragraph",
                        message=(
                            f'"{paras[a][0]}" and "{paras[b][0]}" share a {verbatim} '
                            f"paragraph — drop one or rewrite it."
                        ),
                        text=f"{snippet}…",
                    )
                )
    return findings, covered


def _opener(block: _Block) -> str:
    return " ".join(block.tokens[:_OPENER_WORDS])


def _detect_echoed_openers(blocks: list[_Block]) -> list[Finding]:
    """Flag a section whose opening words echo an earlier section's."""
    findings: list[Finding] = []
    openers: list[tuple[str, str]] = []  # (label, normalized opener)
    for block in blocks:
        opener = _opener(block)
        if len(opener.split()) < 3:
            continue
        for prev_label, prev_opener in openers:
            ratio = SequenceMatcher(None, opener, prev_opener).ratio()
            shares_lead = opener.split()[:3] == prev_opener.split()[:3]
            if ratio >= _OPENER_SIMILARITY or shares_lead:
                lead = " ".join(opener.split()[:_OPENER_WORDS])
                findings.append(
                    Finding(
                        rule="echoed-opener",
                        message=(
                            f'"{block.label}" opens like "{prev_label}" — vary the entry '
                            f"so sections don't all start the same way."
                        ),
                        text=f"{lead}…",
                    )
                )
                break
        openers.append((block.label, opener))
    return findings


def analyze_repetition(draft: Draft) -> list[dict[str, object]]:
    """Return repetition findings for a draft, ordered most-structural first.

    Duplicate paragraphs come first (usually the worst offense), then echoed
    openers, then recycled phrases. Pure read-only analysis — no mutation.
    """
    blocks = _blocks(draft)
    if len(blocks) < 2:
        return []
    dup_findings, covered = _detect_duplicate_paragraphs(blocks)
    findings = (
        dup_findings
        + _detect_echoed_openers(blocks)
        + _detect_repeated_phrases(blocks, covered)
    )
    return [f.as_dict() for f in findings]
