"""Lint draft text against a style pack's manifest rules."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from blogforge.voice.ai_tells import (
    effective_phrases,
    effective_sentence_starters,
    effective_words,
)
from blogforge.voice.packs.manifest import Manifest

Kind = Literal["word", "phrase", "rule"]

LintKind = Literal["banished_word", "banished_phrase", "rule", "positive_hit"]


@dataclass(frozen=True)
class Violation:
    kind: Kind
    message: str
    match: str
    line: int  # 1-indexed
    column: int  # 0-indexed byte offset on that line


@dataclass(frozen=True)
class LintHit:
    """UTF-16-indexed hit. `start`/`end` match JavaScript String.length offsets."""

    start: int
    end: int
    kind: LintKind
    rule_id: str
    message: str


def _utf16_offset(text: str, char_index: int) -> int:
    """Convert a Python char (code point) index to a UTF-16 code-unit offset."""
    return sum(2 if ord(c) >= 0x10000 else 1 for c in text[:char_index])


def lint_to_hits(manifest: Manifest, text: str) -> list[LintHit]:
    """Run lint() and convert Violations to LintHit with UTF-16 offsets."""
    hits: list[LintHit] = []
    lines = text.splitlines(keepends=True)
    line_starts: list[int] = [0]
    for line in lines:
        line_starts.append(line_starts[-1] + len(line))
    _kind_map = {"word": "banished_word", "phrase": "banished_phrase", "rule": "rule"}
    for v in lint(manifest, text):
        line_start = line_starts[v.line - 1]
        start_char = line_start + v.column
        end_char = start_char + len(v.match)
        hits.append(LintHit(
            start=_utf16_offset(text, start_char),
            end=_utf16_offset(text, end_char),
            kind=_kind_map[v.kind],  # type: ignore[arg-type]
            rule_id=f"{v.kind}:{v.match.lower()}",
            message=v.message,
        ))
    return hits


_CONFLICT_OPENERS = re.compile(
    r"\b(for years|most teams struggle|the problem with|anyone who'?s|if you'?ve ever)\b",
    re.IGNORECASE,
)
_S2V_TRIGGERS = re.compile(r"\b(unlock|powerhouse|tipping point|finally)\b", re.IGNORECASE)
_S2V_TIME = re.compile(r"\b\d+\s*(?:minute|hour|day|week|x|\xd7|%)\b", re.IGNORECASE)
_GOLDEN = re.compile(r"(?:^|\n)\s*((?:[A-Z][a-z]+\.\s*){3,4})", re.MULTILINE)
_AI_NEGATION = re.compile(
    r"\b(?:it'?s not just|(?:isn'?t|aren'?t|wasn'?t|weren'?t) just"
    r"|more than just|goes beyond just)\b",
    re.IGNORECASE,
)
_AI_NOT_ONLY = re.compile(r"\bnot only\b[^.?!\n]*\bbut\b", re.IGNORECASE)
_AI_INFLATION = re.compile(
    r"\b(?:serves as|stands as|a testament to|leaves? an indelible mark"
    r"|plays? a (?:vital|crucial|pivotal|key|central) role)\b",
    re.IGNORECASE,
)
_AI_VAGUE_ATTRIBUTION = re.compile(
    r"\b(?:experts?|researchers?|scientists?|analysts?|observers?|critics?|"
    r"studies|research|industry\s+reports?|sources)\s+"
    r"(?:say|says|said|believe[sd]?|note[sd]?|suggest[s]?|show[s]?|report[s]?|"
    r"claim[s]?|argue[s]?|agree[s]?|point\s+out|have\s+(?:shown|noted|argued|found))\b",
    re.IGNORECASE,
)
# Staccato paired-list runs — "Isolation and security. Cost and control. As
# well as speed and scale." Two+ consecutive short bare-pair sentences (a
# single "and", no other connective) read as a chopped-up list; humans vary
# the joinery. Also flags any sentence STARTING "As well as" (a fragment
# masquerading as a sentence).
_PAIR_SENTENCE = re.compile(
    r"^[A-Z][\w'-]*(?:\s+[\w'-]+){0,4}\s+and\s+[\w'-]+(?:\s+[\w'-]+){0,4}[.!?]$"
)
_AS_WELL_AS_START = re.compile(r"(?m)(?:^|(?<=[.!?]\s))As well as\b[^.!?]*[.!?]")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def detect_positive_hits(text: str) -> list[LintHit]:
    """Detect positive-voice heuristics and return LintHit list."""
    hits: list[LintHit] = []

    first_sentence_end = re.search(r"[.!?]", text)
    first_segment = text[: first_sentence_end.end()] if first_sentence_end else text
    for m in _CONFLICT_OPENERS.finditer(first_segment):
        hits.append(LintHit(
            start=_utf16_offset(text, m.start()),
            end=_utf16_offset(text, m.end()),
            kind="positive_hit",
            rule_id="hit:conflict_opener",
            message="Conflict & Resolution opener detected.",
        ))

    for m in _S2V_TRIGGERS.finditer(text):
        window_start = max(0, m.start() - 80)
        window_end = min(len(text), m.end() + 80)
        if _S2V_TIME.search(text[window_start:window_end]):
            hits.append(LintHit(
                start=_utf16_offset(text, m.start()),
                end=_utf16_offset(text, m.end()),
                kind="positive_hit",
                rule_id="hit:speed_to_value",
                message="Speed-to-Value vocabulary near a time/effort claim.",
            ))

    for m in _GOLDEN.finditer(text):
        hits.append(LintHit(
            start=_utf16_offset(text, m.start(1)),
            end=_utf16_offset(text, m.end(1)),
            kind="positive_hit",
            rule_id="hit:golden_command",
            message="Golden Command pattern.",
        ))

    return hits


def detect_ai_patterns(text: str) -> list[LintHit]:
    """Detect high-precision structural AI-writing tells (negation, inflation)."""
    hits: list[LintHit] = []
    specs = (
        (_AI_NEGATION, "ai_pattern:negation", "AI negation/antithesis pattern."),
        (_AI_NOT_ONLY, "ai_pattern:negation", "AI 'not only... but' pattern."),
        (_AI_INFLATION, "ai_pattern:inflation", "AI significance-inflation phrasing."),
        (_AI_VAGUE_ATTRIBUTION, "ai_pattern:vague_attribution",
         "Vague attribution — name the source or cut it."),
    )
    for pattern, rule_id, message in specs:
        for m in pattern.finditer(text):
            hits.append(LintHit(
                start=_utf16_offset(text, m.start()),
                end=_utf16_offset(text, m.end()),
                kind="rule",
                rule_id=rule_id,
                message=message,
            ))

    # Staccato pair runs: walk sentences, flag a run of >=2 consecutive
    # bare-pair sentences (each <=12 words, single "and").
    sentences: list[tuple[int, str]] = []
    pos = 0
    for part in _SENT_SPLIT.split(text):
        idx = text.find(part, pos)
        if idx >= 0:
            sentences.append((idx, part.strip()))
            pos = idx + len(part)
    run_start: int | None = None
    run_len = 0
    run_end = 0
    for idx, sent in [*sentences, (len(text), "")]:
        words = sent.split()
        is_pair = bool(sent) and len(words) <= 12 and bool(_PAIR_SENTENCE.match(sent))
        if is_pair:
            if run_start is None:
                run_start = idx
            run_len += 1
            run_end = idx + len(sent)
        else:
            if run_start is not None and run_len >= 2:
                hits.append(LintHit(
                    start=_utf16_offset(text, run_start),
                    end=_utf16_offset(text, run_end),
                    kind="rule",
                    rule_id="ai_pattern:staccato_pairs",
                    message="Staccato paired-list run — connect the ideas or use a real list.",
                ))
            run_start = None
            run_len = 0

    for m in _AS_WELL_AS_START.finditer(text):
        hits.append(LintHit(
            start=_utf16_offset(text, m.start()),
            end=_utf16_offset(text, m.end()),
            kind="rule",
            rule_id="ai_pattern:staccato_pairs",
            message='Sentence fragment starting "As well as" — fold it into the previous sentence.',
        ))
    return hits


def lint(manifest: Manifest, text: str) -> list[Violation]:
    """Return all violations of `manifest` rules in `text`."""
    violations: list[Violation] = []

    # Build the case-sensitive exception set (term must match exactly, including case).
    exemptions = {ex.term for ex in manifest.banished.permitted_exceptions}

    lines = text.splitlines()

    # Banished words: case-insensitive whole-word match, but exempt exact-case matches.
    for word in effective_words(manifest):
        pattern = re.compile(rf"(?<![\w-])({re.escape(word)})(?![\w-])", re.IGNORECASE)
        for ln_no, line in enumerate(lines, start=1):
            for m in pattern.finditer(line):
                if m.group(1) in exemptions:
                    continue
                violations.append(Violation(
                    kind="word",
                    message=f'banished word: "{m.group(1)}"',
                    match=m.group(1),
                    line=ln_no,
                    column=m.start(1),
                ))

    # Banished phrases: case-insensitive substring match.
    for phrase in effective_phrases(manifest):
        pattern = re.compile(re.escape(phrase), re.IGNORECASE)
        for ln_no, line in enumerate(lines, start=1):
            for m in pattern.finditer(line):
                violations.append(Violation(
                    kind="phrase",
                    message=f'banished phrase: "{m.group(0)}"',
                    match=m.group(0),
                    line=ln_no,
                    column=m.start(0),
                ))

    # Em dash rule.
    if manifest.rules.no_em_dashes:
        for ln_no, line in enumerate(lines, start=1):
            for m in re.finditer("—", line):
                violations.append(Violation(
                    kind="rule",
                    message="em dash not allowed",
                    match="—",
                    line=ln_no,
                    column=m.start(),
                ))

    # ASCII double-hyphen between letters.
    if manifest.rules.no_ascii_double_hyphen_between_letters:
        pattern = re.compile(r"[A-Za-z]--[A-Za-z]")
        for ln_no, line in enumerate(lines, start=1):
            for m in pattern.finditer(line):
                violations.append(Violation(
                    kind="rule",
                    message="ASCII double-hyphen between letters not allowed",
                    match=m.group(),
                    line=ln_no,
                    column=m.start(),
                ))

    # Forbidden sentence starters: at start-of-line OR after ". ", "! ", "? ".
    starters = effective_sentence_starters(manifest)
    if starters:
        starter_alt = "|".join(re.escape(s) for s in starters)
        pattern = re.compile(rf"(?:^|(?<=[.!?]\s))({starter_alt})\b")
        for ln_no, line in enumerate(lines, start=1):
            for m in pattern.finditer(line):
                violations.append(Violation(
                    kind="rule",
                    message=f'sentence starts with "{m.group(1)}"',
                    match=m.group(1),
                    line=ln_no,
                    column=m.start(1),
                ))

    return violations
