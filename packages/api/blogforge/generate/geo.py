"""GEO (Generative Engine Optimization) analysis for a draft.

Scores a draft on the on-page/structural levers the Princeton GEO study and
Google's 2026 guidance validate — answer-first sections, factual density,
question headings, skimmability, self-contained passages, a definitional
opener, and an FAQ. Deterministic structural checks run in-process; three
judgment levers (answer-first, definitional opener, factual density) come from
one voice-aware LLM pass.

Two honesty rules baked in:
- The score is *structural readiness*, NOT a citation guarantee.
- Factual density is FLAGGED, never fabricated — the tool prompts the writer to
  add real data; it never invents statistics or citations.
"""

# The GEO copy intentionally uses typographic ranges in writer-facing text.
# ruff: noqa: RUF001, RUF003

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from blogforge.drafts.models import Draft
from blogforge.generate.sanitize import strip_scaffolding
from blogforge.generate.textutil import strip_inline_emphasis
from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import (
    FACTUAL_RATIONALE,
    OUTPUT_RATIONALE,
    PRESERVATION_RATIONALE,
    VOICE_RATIONALE,
    PromptRule,
    render_prompt_rules,
)

# Weights sum to 1.0; the two most-cited levers (answer-first, factual density)
# carry the most, with citations — the strongest researched lever — right after.
# build_report normalizes by the weights actually PRESENT, so levers can land
# across phases without deflating the total.
_WEIGHTS: dict[str, float] = {
    "answer_first": 0.09,
    "factual_density": 0.07,
    "freshness": 0.06,
    "citations": 0.06,
    "information_gain": 0.06,
    "semantic_triples": 0.05,
    "expert_quotes": 0.05,
    "stat_attribution": 0.05,
    "answer_capsule": 0.04,
    "page_front_load": 0.04,
    "intent_format_match": 0.04,
    "experience_signals": 0.04,
    "query_coverage": 0.04,
    "definitional_opener": 0.03,
    "question_headings": 0.03,
    "skimmability": 0.03,
    "chunking": 0.03,
    "brand_explicit": 0.03,
    "takeaways": 0.02,
    "comparison_table": 0.02,
    "faq": 0.02,
    "definitive_language": 0.02,
    "entity_consistency": 0.02,
    "jargon_defined": 0.02,
    "concrete_examples": 0.02,
    "sound_bites": 0.01,
    "title_shape": 0.01,
}
# Display order in the panel (roughly by leverage).
_ORDER = (
    "answer_first",
    "factual_density",
    "freshness",
    "citations",
    "information_gain",
    "semantic_triples",
    "expert_quotes",
    "stat_attribution",
    "answer_capsule",
    "page_front_load",
    "intent_format_match",
    "experience_signals",
    "query_coverage",
    "definitional_opener",
    "question_headings",
    "skimmability",
    "chunking",
    "brand_explicit",
    "takeaways",
    "comparison_table",
    "faq",
    "definitive_language",
    "entity_consistency",
    "jargon_defined",
    "concrete_examples",
    "sound_bites",
    "title_shape",
)
_LABELS: dict[str, str] = {
    "answer_first": "Answer-first sections",
    "factual_density": "Factual density",
    "citations": "Cited sources",
    "definitional_opener": "Definitional opener",
    "takeaways": "Key-takeaways block",
    "brand_explicit": "Brand named explicitly",
    "question_headings": "Question headings",
    "skimmability": "Skimmability",
    "freshness": "Freshness signals",
    "comparison_table": "Comparison table",
    "faq": "FAQ section",
    "chunking": "Self-contained passages",
    "stat_attribution": "Stats tied to sources",
    "query_coverage": "Covers follow-up questions",
    "sound_bites": "Liftable sound bites",
    "entity_consistency": "Consistent entity names",
    "experience_signals": "First-hand experience",
    "jargon_defined": "Jargon defined on first use",
    "concrete_examples": "Worked examples",
    "title_shape": "Title shape",
    "information_gain": "Original information",
    "semantic_triples": "Direct S-V-O claims",
    "intent_format_match": "Format matches intent",
    "expert_quotes": "Named expert quotes",
    "answer_capsule": "Answer capsule up top",
    "page_front_load": "Facts front-loaded",
    "definitive_language": "Definitive language",
}

# One concrete sentence of GEO mechanism per lever — WHY the lever moves
# citations, shown on lever headers and as the fallback for findings whose
# semantic pass didn't supply a per-finding impact.
_IMPACTS: dict[str, str] = {
    "answer_first": "Answer engines quote the first 40-60 words of a section; burying the "
    "answer means they quote someone else's page.",
    "factual_density": "Passages with concrete numbers are what engines lift into answers — "
    "vague claims get skipped.",
    "citations": "Claims with named sources are trusted and cited; unattributed claims get "
    "filtered as unverifiable.",
    "definitional_opener": "A one-line definition up top is one of the most reliably "
    "extracted sentence shapes for 'what is X' queries.",
    "question_headings": "Question headings match how users phrase queries — engines map "
    "query to heading directly.",
    "skimmability": "Engines parse structure; walls of prose fragment poorly into answer "
    "passages.",
    "brand_explicit": "AI can cite content without naming you ('ghost citation') — an "
    "explicit brand travels with the quote.",
    "faq": "FAQ blocks are eligible for People-Also-Ask and schema.org/FAQPage rich "
    "results, a separate surface from the body.",
    "chunking": "Each passage is extracted alone — a chunk that leans on its neighbors loses "
    "its meaning when lifted.",
    "takeaways": "Key-takeaways blocks are pre-digested summaries engines prefer over "
    "synthesizing their own.",
    "freshness": "Dated claims signal current content; engines demote pieces they can't "
    "place in time.",
    "comparison_table": "Tables answer 'X vs Y' queries directly — engines lift rows "
    "verbatim.",
    "stat_attribution": "A number tied to a named source is a citable fact; a bare number is "
    "just a claim.",
    "query_coverage": "Answering the follow-up questions keeps the engine on your page "
    "instead of blending in a competitor's.",
    "sound_bites": "Engines lift single self-contained sentences verbatim — give them one "
    "worth lifting.",
    "entity_consistency": "One canonical name per thing is how engines resolve WHO the "
    "piece is about; aliases dilute the entity.",
    "experience_signals": "First-hand evidence ('we measured') is the E in E-E-A-T — "
    "generic AI content can't fake it.",
    "jargon_defined": "A term defined on first use keeps the passage self-contained when "
    "extracted alone.",
    "concrete_examples": "How-to queries surface pages with worked examples; claims "
    "without one lose to pages that show it.",
    "title_shape": "A how-to/number/year hook under 60 chars survives SERP truncation and "
    "matches query templates.",
    "information_gain": "Engines prefer non-commodity content — pages with first-party data "
    "are ~4.5x more likely to be cited than re-reported summaries.",
    "semantic_triples": "A direct subject-verb-object claim is what an engine copies whole; "
    "a claim buried in a subordinate clause has to be rewritten to be quoted.",
    "intent_format_match": "Engines map a query archetype straight to a matching structural "
    "shape — a how-to that isn't numbered steps loses to one that is.",
    "expert_quotes": "A named, credentialed third-party voice is independent corroboration — "
    "engines weight it above the author's own unverified claims.",
    "answer_capsule": "Indig's citation study found 40-75-word self-contained openers get "
    "lifted verbatim at a 3.1x higher rate than longer or link-heavy ones.",
    "page_front_load": "44.2% of AI citations draw from the first 30% of a page — facts "
    "buried below that line are far less likely to be quoted.",
    "definitive_language": "Definitive 'X is' statements get quoted roughly 2x more than "
    "hedged ones — engines skip claims qualified with may/might/could.",
}

_QUESTION_WORDS = (
    "how",
    "what",
    "why",
    "when",
    "where",
    "who",
    "which",
    "can",
    "does",
    "do",
    "is",
    "are",
    "should",
    "will",
)
_LIST_RE = re.compile(r"(?m)^\s*(?:[-*+]\s+|\d+\.\s+|\|)")
# An image with empty alt text — invisible to parsers/screen readers.
_IMG_NOALT_RE = re.compile(r"!\[\s*\]\([^)]+\)")
_THIN_SECTION_WORDS = 40
_BACKREF_RE = re.compile(
    r"(?i)\bas (?:mentioned|noted|discussed|described|explained|shown|we saw) "
    r"(?:above|earlier|previously|below)\b|\bin the (?:previous|next|preceding) section\b"
)
# A TL;DR / key-takeaways block near the top: a heading OR a bold lead-in. The
# most-lifted extraction target for AI answer engines.
_TAKEAWAYS_RE = re.compile(
    r"(?im)^(?:#{2,4}\s*|\*\*)(key takeaways?|tl;?dr|at a glance|in short)\b"
)
_FAQ_TITLE_RE = re.compile(r"(?i)\b(faqs?|frequently asked|common questions|q ?& ?a|q and a)\b")
# FAQ appended inside a section (the GEO fix adds "### FAQ" to the last section
# rather than spawning a new section card).
_FAQ_CONTENT_RE = re.compile(
    r"(?im)^#{2,4}\s*(faqs?|frequently asked|common questions|q ?& ?a|q and a)\b"
)

# A Markdown table is a pipe row followed by a separator row (---|--- with
# optional colons). Both must be present, so a lone `|` in prose doesn't count.
_TABLE_ROW_RE = re.compile(r"(?m)^\s*\|.*\|\s*$")
_TABLE_SEP_RE = re.compile(r"(?m)^\s*\|?[ :|-]*-{3,}[ :|-]*\|.*$")
# Language that signals a section is comparing options/versions/tradeoffs — the
# content that earns an AI citation far more often when laid out as a table.
_COMPARE_RE = re.compile(
    r"(?i)\b(?:versus|vs\.?|compared? (?:to|with|against)|comparison|"
    r"trade-?offs?|pros and cons|option [a-z0-9]|tiers?|pricing plans?|"
    r"(?:cheaper|faster|better|stronger|slower) than|"
    r"alternatives?|which (?:one|option|approach|tool) (?:is|to))\b"
)
# Corporate buzzwords that, when dense and unaccompanied by any concrete number,
# mark a sentence as fluff — discounted by AI answer engines and Google alike.
_BUZZWORDS = (
    "leverage",
    "synergy",
    "robust",
    "cutting-edge",
    "seamless",
    "seamlessly",
    "world-class",
    "best-in-class",
    "best of breed",
    "revolutionary",
    "game-changing",
    "game changer",
    "next-generation",
    "next generation",
    "paradigm",
    "holistic",
    "turnkey",
    "mission-critical",
    "empower",
    "empowering",
    "unlock",
    "supercharge",
    "frictionless",
    "bleeding-edge",
    "state-of-the-art",
    "industry-leading",
    "unparalleled",
    "innovative",
    "transformative",
    "disruptive",
    "streamline",
    "streamlined",
)
_BUZZ_RE = re.compile(r"(?i)\b(?:" + "|".join(re.escape(w) for w in _BUZZWORDS) + r")\b")
_NUMBER_RE = re.compile(r"\d")
# A markdown link to an external source — the citations lever's structural floor.
_OUTLINK_RE = re.compile(r"\[[^\]]+\]\(https?://[^)]+\)")
# Dated evidence for the freshness lever: "March 2026" / "2026-03", or "as of".
_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_DATED_RE = re.compile(rf"(?i)\b(?:{_MONTHS})\.?\s+20\d\d\b|\b20\d\d-[01]\d\b")
_ASOF_RE = re.compile(r"(?i)\bas of\b|\bupdated:?\b")

_LONG_PARA_CHARS = 700
_LONG_SECTION_WORDS = 400

# Answer-capsule / front-load / definitive-language helpers (2026 batch).
_MD_LINK_RE = re.compile(r"\[[^\]]+\]\([^)]+\)")
# "may" is deliberately case-SENSITIVE (lowercase only): the capitalized month
# ("as of May 2026", "in May, we shipped") must never be flagged as a hedge —
# that's the exact dated-attribution shape the freshness/stat_attribution
# levers reward, so miscounting it would have this lever contradict those. The
# other hedge words stay case-insensitive; none of them collide with a proper
# noun the way "may" does.
_HEDGE_RE = re.compile(
    r"\bmay\b|(?i:\b(?:might|could|perhaps|possibly|somewhat|arguably|it seems|it appears|"
    r"some believe)\b)"
)
_DIGIT_RE = re.compile(r"\d")
_SENT_SPLIT_GEO = re.compile(r"(?<=[.!?])\s+")


def _first_paragraph(text: str) -> str:
    for block in text.split("\n\n"):
        b = block.strip()
        if b and not b.startswith("#"):
            return b
    return ""


def _has_table(text: str) -> bool:
    return bool(_TABLE_ROW_RE.search(text) and _TABLE_SEP_RE.search(text))


def _lever(
    key: str,
    score: float,
    detail: str,
    findings: list[dict[str, str]] | None = None,
    fix: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": _LABELS[key],
        "score": max(0, min(100, round(score))),
        # Its share of the overall score — carried so a targeted per-lever
        # re-score can recompute the total on the client without a full re-run.
        "weight": _WEIGHTS.get(key, 0.0),
        "detail": detail,
        "impact": _IMPACTS.get(key, ""),
        "findings": findings or [],
        "fix": fix,
    }


def _is_question(title: str) -> bool:
    # Strip emphasis first so a bold question heading (**How…?**) still counts.
    t = strip_inline_emphasis(title).lower()
    if t.endswith("?"):
        return True
    first = t.split(" ", 1)[0] if t else ""
    return first in _QUESTION_WORDS


def _longest_paragraph(text: str) -> str:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return max(paras, key=len, default="")


# Sentence boundary: punctuation, optional closing quotes/paren, whitespace.
# u201d/u2019 are the typographic closing double/single quotes.
_SENT_SPLIT = re.compile(r"(?<=[.!?])[\"'\u201d\u2019)]*\s+")


def _norm_sentence(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def detect_duplicate_opening(content: str) -> str | None:
    """Return the verbatim leading block when a section OPENS with the same
    sentence twice back-to-back (quote-glyph/punctuation differences ignored)
    — the signature of an opener inserted next to an existing one. None when
    the opening is clean."""
    body = content.strip()
    m1 = _SENT_SPLIT.search(body)
    if not m1:
        return None
    s1 = body[: m1.start()]
    rest = body[m1.end() :]
    m2 = _SENT_SPLIT.search(rest)
    s2 = rest[: m2.start()] if m2 else rest
    if not _norm_sentence(s1) or _norm_sentence(s1) != _norm_sentence(s2):
        return None
    end = m1.end() + (m2.start() if m2 else len(rest))
    # Include the second copy's closing quotes so the block splices cleanly.
    while end < len(body) and body[end] in "\"'\u201d\u2019)":
        end += 1
    return body[:end]


def augment_definitional(levers: dict[str, dict[str, Any]], draft: Draft) -> None:
    """Deterministic addendum to the semantic definitional-opener lever: a
    back-to-back duplicated opening sentence is an objective defect with a
    mechanical fix — surface it first with a one-click dedupe and cap the
    lever score."""
    lever = levers.get("definitional_opener")
    if not lever or not draft.sections:
        return
    first = draft.sections[0]
    dup = detect_duplicate_opening(first.content_md)
    if not dup:
        return
    lever["findings"] = [
        {
            "section_id": first.id,
            "target": dup,
            "note": "The opening sentence appears twice back-to-back — keep one copy.",
            "fix": "dedupe_opening",
        },
        *lever["findings"],
    ]
    lever["score"] = min(lever["score"], 45)


def _fluff_sentences(text: str, limit: int = 3) -> list[str]:
    """Sentences piling on buzzwords with no concrete number — the fluff that AI
    answer engines and Google's quality systems both discount."""
    out: list[str] = []
    for raw in _SENT_SPLIT.split(text):
        s = raw.strip()
        if s and len(_BUZZ_RE.findall(s)) >= 2 and not _NUMBER_RE.search(s):
            out.append(s)
        if len(out) >= limit:
            break
    return out


def augment_factual_density(levers: dict[str, dict[str, Any]], draft: Draft) -> None:
    """Deterministic addendum to the semantic factual-density lever: buzzword-
    dense, number-free sentences are objective fluff. Surface them as thin spots
    (with a concrete swap suggestion) and cap the score so vague prose can't grade
    well on the single best-proven citation lever."""
    lever = levers.get("factual_density")
    if not lever:
        return
    flagged = [
        {
            "target": sent,
            "note": "Buzzword-heavy with no concrete number — AI and Google discount fluff.",
            "suggestion": "Swap the jargon for one real stat, example, or named source.",
        }
        for s in draft.sections
        for sent in _fluff_sentences(s.content_md)
    ]
    if not flagged:
        return
    lever["findings"] = [*lever["findings"], *flagged[:3]]
    lever["score"] = min(lever["score"], 70)


def augment_citations(levers: dict[str, dict[str, Any]], draft: Draft) -> None:
    """Deterministic floor for the citations lever: a draft with zero outbound
    source links anywhere can't grade above 40, whatever the semantic judge says
    about named-but-unlinked attributions."""
    lever = levers.get("citations")
    if lever is None:
        return
    if not _OUTLINK_RE.search(_draft_text(draft)) and lever["score"] > 40:
        lever["score"] = 40
        lever["detail"] = (lever["detail"] + " No outbound source links anywhere.").strip()


def _longest_paragraph_chars(text: str) -> int:
    return len(_longest_paragraph(text))


def _draft_text(draft: Draft) -> str:
    parts = [f"# {draft.title or draft.idea.topic}"]
    # The opening/lede lives above the first section (outline.opening_hook), so
    # it must lead the text the model scores — otherwise the definitional-opener
    # and answer-first levers judge the first SECTION instead of the real intro.
    # Editorial scaffolding (parked material, alt versions, reminders) is stripped
    # so no lever scores it and no generator (FAQ, opener, etc.) grounds output
    # on it. This is the single choke point every generator reads through.
    opening = strip_scaffolding(draft.outline.opening_hook) if draft.outline else ""
    if opening:
        parts.append(opening)
    for s in draft.sections:
        body = strip_scaffolding(s.content_md)
        parts.append(f"## {s.title}\n\n{body}" if body else f"## {s.title}")
    return "\n\n".join(parts)


def score_structural(draft: Draft) -> dict[str, dict[str, Any]]:
    """Deterministic GEO levers — no LLM, computed straight off the markdown."""
    sections = draft.sections
    n = len(sections) or 1

    # Question headings.
    q = sum(1 for s in sections if _is_question(s.title))
    share = q / n
    qh_findings = [
        {
            "section_id": s.id,
            "note": f'Heading "{strip_inline_emphasis(s.title)}" isn\'t phrased as a question.',
            "fix": "question_heading",
        }
        for s in sections
        if not _is_question(s.title)
    ]
    question = _lever(
        "question_headings",
        min(100, 40 + share * 120),
        f"{q} of {len(sections)} headings read as questions.",
        findings=qh_findings,
        fix="question_heading" if qh_findings else None,
    )

    # Skimmability.
    has_list = any(_LIST_RE.search(s.content_md) for s in sections)
    walls = [
        s
        for s in sections
        if not _LIST_RE.search(s.content_md)
        and _longest_paragraph_chars(s.content_md) > _LONG_PARA_CHARS
    ]
    # Images with empty alt text — invisible to parsers; drop 5 each (floor 50).
    alt_findings = [
        {
            "section_id": s.id,
            "target": m.group(0),
            "note": "Image has no alt text — invisible to parsers and screen readers.",
            "fix": "alt_text",
        }
        for s in sections
        for m in _IMG_NOALT_RE.finditer(s.content_md)
    ]
    if not has_list:
        sk_score = 40.0
        sk_detail = "No lists or tables — add bullets, numbered steps, or a comparison table."
    else:
        sk_score = max(50.0, 100 - 15 * len(walls) - 5 * len(alt_findings))
        sk_detail = "Uses lists." + (
            f" {len(walls)} dense block(s) could use bullets." if walls else ""
        )
    skim = _lever(
        "skimmability",
        sk_score,
        sk_detail,
        findings=[
            {
                "section_id": s.id,
                # The exact dense paragraph, so the fix bulletizes ONLY this
                # block and splices it back — not the whole section.
                "target": _longest_paragraph(s.content_md),
                "note": f'This paragraph in "{strip_inline_emphasis(s.title)}" is dense — a '
                "lead-in line plus a few bullets would read faster.",
                "fix": "bullets",
            }
            for s in walls
        ]
        + alt_findings,
    )

    # FAQ presence — as a section title OR an in-section heading.
    has_faq = any(
        _FAQ_TITLE_RE.search(s.title) or _FAQ_CONTENT_RE.search(s.content_md) for s in sections
    )
    faq = _lever(
        "faq",
        100 if has_faq else 30,
        "Has an FAQ section."
        if has_faq
        else "No FAQ — AI engines lift Q&A pairs directly into answers.",
        fix=None if has_faq else "faq",
    )

    # Chunking / self-contained passages.
    backrefs: list[dict[str, str]] = []
    for s in sections:
        for m in _BACKREF_RE.finditer(s.content_md):
            backrefs.append(
                {
                    "section_id": s.id,
                    "note": f'"{m.group(0)}" breaks the passage out of context.',
                    "fix": "self_contained",
                }
            )
    longsecs = [s for s in sections if s.word_count > _LONG_SECTION_WORDS]
    # Thin sections are advisory (no deduction): too little to stand alone as a
    # cited chunk. The citation sweet-spot is ~120-180 words per heading.
    thinsecs = [s for s in sections if 0 < s.word_count < _THIN_SECTION_WORDS]
    ch_findings = (
        backrefs
        + [
            {
                "section_id": s.id,
                "note": f'"{strip_inline_emphasis(s.title)}" is long ({s.word_count} words) — '
                "split it into two sections with their own headings so each chunk stands alone.",
            }
            for s in longsecs
        ]
        + [
            {
                "section_id": s.id,
                "note": f'"{strip_inline_emphasis(s.title)}" is thin ({s.word_count} words) — '
                "too little to stand alone as a cited chunk.",
            }
            for s in thinsecs
        ]
    )
    chunk = _lever(
        "chunking",
        max(40, 100 - 10 * len(backrefs) - 10 * len(longsecs)),
        "Passages stand on their own; best-cited chunks run ~120-180 words per heading."
        if not ch_findings
        else f"{len(backrefs)} back-reference(s), {len(longsecs)} over-long section(s). "
        "Best-cited chunks run ~120-180 words per heading.",
        findings=ch_findings,
    )

    # Comparison table — a section that compares options/versions/tradeoffs but
    # renders them as prose gets cited far less than the same content as a table.
    # We only flag sections that (a) read as a comparison and (b) have no table;
    # a post with nothing to compare passes at 100 (no false penalty).
    table_candidates = [
        s for s in sections if _COMPARE_RE.search(s.content_md) and not _has_table(s.content_md)
    ]
    any_table = any(_has_table(s.content_md) for s in sections)
    if not table_candidates:
        ct_score = 100.0
        ct_detail = (
            "Has a comparison table." if any_table else "No comparison-worthy content detected."
        )
    else:
        ct_score = 55.0
        ct_detail = (
            f"{len(table_candidates)} section(s) compare options in prose — a table gets lifted "
            "into AI answers far more often."
        )
    comparison = _lever(
        "comparison_table",
        ct_score,
        ct_detail,
        findings=[
            {
                "section_id": s.id,
                "note": f'"{strip_inline_emphasis(s.title)}" compares options in prose — '
                "a comparison table is more citable.",
                "fix": "comparison_table",
            }
            for s in table_candidates
        ],
        fix="comparison_table" if table_candidates else None,
    )

    # Key-takeaways / TL;DR block — a heading or bold lead-in in the opening or
    # any section. The single most-lifted near-top extraction target.
    opening = draft.outline.opening_hook if draft.outline else ""
    has_takeaways = bool(_TAKEAWAYS_RE.search(opening)) or any(
        _TAKEAWAYS_RE.search(s.content_md) for s in sections
    )
    takeaways = _lever(
        "takeaways",
        100 if has_takeaways else 45,
        "Has a key-takeaways block."
        if has_takeaways
        else "No TL;DR/key-takeaways block — the most-lifted extraction target near the top.",
        fix=None if has_takeaways else "takeaways",
    )

    # Freshness — dated, current-looking evidence (engines favor it). Flag-only:
    # the tool never invents dates.
    fresh_mentions = sum(len(_DATED_RE.findall(s.content_md)) for s in sections)
    fresh_mentions += len(_DATED_RE.findall(opening))
    intro_text = opening or (sections[0].content_md if sections else "")
    intro_dated = bool(_DATED_RE.search(intro_text) or _ASOF_RE.search(intro_text))
    if intro_dated and fresh_mentions >= 2:
        fr_score, fr_detail, fr_findings = 100.0, "Dated evidence, current-looking.", []
    elif fresh_mentions >= 1:
        fr_score, fr_detail = 70.0, "Some dated evidence — stamp more key claims with real dates."
        fr_findings = [
            {
                "note": "Only one dated mention — anchor key claims with real dates "
                "('as of March 2026') so engines see when the facts were true."
            }
        ]
    else:
        fr_score = 40.0
        fr_detail = "No dated evidence — add real 'as of' dates (via inline edit) to key claims."
        fr_findings = [
            {"note": "No dates anywhere — engines favor content that shows when its facts held."}
        ]
    freshness = _lever("freshness", fr_score, fr_detail, findings=fr_findings)

    full = _draft_text(draft)

    # Answer capsule — a 40–75-word link-free opener naming the title entity
    # (Indig: 72.4% citation rate; 40–75-word passages cited 3.1x more).
    para = _first_paragraph(full)
    wc = len(para.split())
    title_tokens = [t for t in re.findall(r"[A-Za-z][\w-]+", draft.title or "") if len(t) > 3]
    first_sentence = para.split(".")[0].lower()
    names_entity = any(t.lower() in first_sentence for t in title_tokens) if title_tokens else True
    capsule_ok = 40 <= wc <= 75 and not _MD_LINK_RE.search(para) and names_entity
    cap_findings = []
    if not capsule_ok:
        why = (
            f"Opening paragraph is {wc} words (target 40–75)" if not 40 <= wc <= 75
            else "Opening paragraph contains links" if _MD_LINK_RE.search(para)
            else "Opening sentence never names the subject"
        )
        cap_findings = [{"target": para[:200], "note": f"{why} — answer engines lift "
                         "self-contained 40–75-word openers verbatim.", "fix": "capsule"}]
    caps = _lever(
        "answer_capsule",
        90 if capsule_ok else (50 if 20 <= wc <= 110 else 30),
        "Opening paragraph works as a liftable answer capsule." if capsule_ok
        else "No 40–75-word self-contained, link-free opening capsule.",
        findings=cap_findings,
        fix="capsule" if cap_findings else None,
    )

    # Page front-load — share of digit-bearing (factual) sentences that land in
    # the first 30% of the document (Indig: 44.2% of citations come from there).
    sentences = [s for s in _SENT_SPLIT_GEO.split(full) if s.strip()]
    facts = [i for i, s in enumerate(sentences) if _DIGIT_RE.search(s)]
    if not facts or len(sentences) < 8:
        front_load = _lever("page_front_load", 50,
                            "Too little factual content to judge front-loading.")
    else:
        cutoff = max(1, int(len(sentences) * 0.30))
        share = sum(1 for i in facts if i < cutoff) / len(facts)
        front_load = _lever(
            "page_front_load",
            min(100, max(20, int(share * 200))),
            f"{int(share * 100)}% of factual sentences sit in the first 30% of the piece.",
        )

    # Definitive language — hedge-word density (definitive "X is" claims are
    # quoted ~2x more; hedged sentences get skipped).
    hedged = [s.strip() for s in sentences if _HEDGE_RE.search(s)]
    ratio = len(hedged) / max(1, len(sentences))
    definitive = _lever(
        "definitive_language",
        max(0, int(100 - ratio * 400)),
        f"{len(hedged)} of {len(sentences)} sentences hedge (may/might/could/perhaps).",
        findings=[{"target": h[:200], "note": "Hedged claim — engines quote statements "
                   "they can lift without qualification.", "fix": "definitive"}
                  for h in hedged[:3]],
        fix="definitive" if hedged else None,
    )

    return {
        "question_headings": question,
        "skimmability": skim,
        "faq": faq,
        "chunking": chunk,
        "comparison_table": comparison,
        "takeaways": takeaways,
        "freshness": freshness,
        "answer_capsule": caps,
        "page_front_load": front_load,
        "definitive_language": definitive,
    }


_GENERIC_LEVER_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "score": {"type": "integer"},
        "note": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "note": {"type": "string"},
                    "suggestion": {"type": "string"},
                    "impact": {"type": "string"},
                },
                "required": ["note"],
            },
        },
    },
    "required": ["score", "note"],
}

_NEW_SEMANTIC_KEYS = (
    "stat_attribution",
    "query_coverage",
    "sound_bites",
    "entity_consistency",
    "experience_signals",
    "jargon_defined",
    "concrete_examples",
    "title_shape",
    # 2026 research batch:
    "information_gain",
    "semantic_triples",
    "intent_format_match",
    "expert_quotes",
)

_SEMANTIC_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "answer_first": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "note": {"type": "string"},
                "weak_sections": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["score", "note"],
        },
        "definitional_opener": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "note": {"type": "string"},
                "has_definition": {"type": "boolean"},
            },
            "required": ["score", "note", "has_definition"],
        },
        "factual_density": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "note": {"type": "string"},
                "has_stats": {"type": "boolean"},
                "has_named_sources": {"type": "boolean"},
                "has_quotes": {"type": "boolean"},
                "first_hand": {"type": "boolean"},
                "thin_spots": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "target": {"type": "string"},
                            "note": {"type": "string"},
                            "suggestion": {"type": "string"},
                            "impact": {"type": "string"},
                        },
                        "required": ["target"],
                    },
                },
            },
            "required": ["score", "note"],
        },
        "brand_explicit": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "note": {"type": "string"},
                "brand": {"type": "string"},
                "stated_up_top": {"type": "boolean"},
            },
            "required": ["score", "note"],
        },
        "citations": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "note": {"type": "string"},
                "uncited_claims": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "target": {"type": "string"},
                            "note": {"type": "string"},
                            "suggestion": {"type": "string"},
                            "matched_source_url": {"type": "string"},
                            "impact": {"type": "string"},
                        },
                        "required": ["target"],
                    },
                },
            },
            "required": ["score", "note"],
        },
        "coverage": {
            "type": "object",
            "properties": {
                "missing_subquestions": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    "required": [
        "answer_first",
        "definitional_opener",
        "factual_density",
        "brand_explicit",
        "citations",
        # The 8 new levers are REQUIRED so structured decoding forces the model
        # to emit them. Absent → parse_semantic returns them at 0 → those zeros
        # deflate the weighted total (the 8 carry 0.24), grading a good draft far
        # too low. parse_semantic stays tolerant; required is belt-and-suspenders.
        *_NEW_SEMANTIC_KEYS,
    ],
}
_SEMANTIC_SCHEMA["properties"].update(  # type: ignore[attr-defined]
    {k: _GENERIC_LEVER_SCHEMA for k in _NEW_SEMANTIC_KEYS}
)

# The JSON shape the model is shown in the prompt. A concrete example is the
# model's dominant anchor for what to emit — it MUST list every semantic lever
# (all of _SEMANTIC_KEYS) or the omitted ones come back absent and score 0.
# test_semantic_example_covers_all_levers guards this.
_SEMANTIC_EXAMPLE = json.dumps(
    {
        "answer_first": {"score": 0, "note": "", "weak_sections": []},
        "definitional_opener": {"score": 0, "note": "", "has_definition": False},
        "factual_density": {
            "score": 0,
            "note": "",
            "has_stats": False,
            "has_named_sources": False,
            "has_quotes": False,
            "first_hand": False,
            "thin_spots": [],
        },
        "brand_explicit": {"score": 0, "note": "", "brand": "", "stated_up_top": False},
        "citations": {"score": 0, "note": "", "uncited_claims": []},
        **{
            k: {
                "score": 55,
                "note": "",
                "findings": [{"target": "", "note": "", "suggestion": "", "impact": ""}],
            }
            for k in _NEW_SEMANTIC_KEYS
        },
        "coverage": {"missing_subquestions": []},
    }
)

_SEMANTIC_DIRECTIVE = (
    "Evaluate this draft on the following Generative-Engine-Optimization dimensions. "
    "The descriptions explain what each lever measures.\n"
    "1) answer_first: whether each section opens with a direct, self-contained answer "
    "(40-60 words) before context.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "List the titles of sections that bury the answer in `weak_sections`.",
                "The client maps those titles back to sections where the writer can apply a fix.",
            )
        ],
        bullet=True,
    )
    + "\n2) definitional_opener: whether the piece opens with a clear, citable one-line "
    "definition of its subject or thesis.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Set `has_definition` true when a definition exists near the top, even if it "
                "is badly placed, duplicated, or buried; let the score reflect execution.",
                "The client must improve an existing definition instead of adding a duplicate.",
            )
        ],
        bullet=True,
    )
    + "\n3) factual_density: whether the draft uses specific statistics, named sources, "
    "quotes, and first-hand evidence instead of vague claims.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Set `has_stats`, `has_named_sources`, and `has_quotes` to reflect what is "
                "present, and name each missing evidence type in `note`.",
                "The analysis panel shows which kinds of factual support the writer still needs.",
            ),
            PromptRule(
                "In `thin_spots`, quote vague passages, name the problem in `note`, and "
                "describe the specific kind and likely origin of supporting data in `suggestion`.",
                "Actionable findings tell the writer what evidence to collect without "
                "fabricating it.",
            ),
            PromptRule(
                "Set `first_hand` true only when the author reports direct experience such as "
                "something they tested, built, or measured.",
                "First-hand evidence is distinct from secondhand summary and affects this lever.",
            ),
        ],
        bullet=True,
    )
    + "\n4) brand_explicit: whether the product, brand, or subject is named clearly and "
    "early enough for its name to travel with a citation.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Put the detected brand in `brand`, set `stated_up_top` true only when it "
                "appears in the first section, and say in `note` when no brand is evident.",
                "The panel needs the observed name and placement rather than an inferred brand.",
            )
        ],
        bullet=True,
    )
    + "\n5) citations: whether concrete, checkable claims carry sources.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Match uncited claims against ATTACHED SOURCES before recommending a new source.",
                "The author should be able to use evidence they already collected.",
            ),
            PromptRule(
                "For a matching attached source, name it in `note`, copy its URL into "
                "`matched_source_url`, and put the verbatim claim with a Markdown link inserted "
                "at natural anchor text in `suggestion`.",
                "The client can apply a matched citation directly only when these fields "
                "are exact.",
            ),
            PromptRule(
                "For a claim no attached source covers, name the specific kind of source to find "
                "instead of giving a generic request to add sources.",
                "A concrete source type turns the finding into a useful research action.",
            ),
            PromptRule(
                "When sources are attached, acknowledge their total and in-text citation count "
                "in the lever `note`.",
                "The writer needs to distinguish missing evidence from collected but unused "
                "evidence.",
            ),
        ],
        bullet=True,
    )
    + "\ncoverage: natural in-scope subquestions a search engine could decompose from the "
    "title but the draft does not answer.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "List at most four genuinely in-scope unanswered questions in "
                "`coverage.missing_subquestions`.",
                "The FAQ fix needs a focused set of relevant coverage gaps.",
            ),
            PromptRule(
                "Return exactly one concrete sentence in `impact` for every thin spot and "
                "uncited claim without restating the fix.",
                "The panel needs a concise explanation of each recommendation's "
                "answer-engine payoff.",
            ),
        ],
        bullet=True,
    )
    + "\n6) stat_attribution: whether numbers are tied inline to named sources, so a number "
    "reads as a citable fact rather than a bare claim.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag unattributed statistics in `findings` and copy each statistic-bearing "
                "passage into `target`.",
                "The writer needs to locate the exact number that lacks attribution.",
            )
        ],
        bullet=True,
    )
    + "\n7) query_coverage: whether the piece answers adjacent questions such as cost, "
    "limits, alternatives, and prerequisites.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag the largest coverage gaps with the missing question in `note` and its "
                "best location in `suggestion`.",
                "The writer needs both the unanswered question and where it belongs.",
            )
        ],
        bullet=True,
    )
    + "\n8) sound_bites: whether the draft contains at least two self-contained sentences "
    "under 25 words that an engine could quote verbatim.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag sections whose point never lands in one liftable line.",
                "Those sections lack a compact extraction target.",
            )
        ],
        bullet=True,
    )
    + "\n9) entity_consistency: whether each product or technology uses one canonical name.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag alias drift and put the canonical name in `suggestion`.",
                "A consistent entity name helps answer engines resolve what the passage describes.",
            )
        ],
        bullet=True,
    )
    + "\n10) experience_signals: whether the author reports first-hand experience such as "
    "a measurement, a build decision, or a result.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag sections that read only as secondhand summary.",
                "The writer needs to see where first-hand evidence is absent.",
            )
        ],
        bullet=True,
    )
    + "\n11) jargon_defined: whether each specialist term receives a short appositive "
    "definition on first use.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag undefined first uses and put the term in `target`.",
                "The client previews the exact jargon that needs a definition.",
            )
        ],
        bullet=True,
    )
    + "\n12) concrete_examples: whether how-to claims are backed by a worked example or "
    "code block.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag claims that assert a procedure or result without showing it.",
                "The writer needs to know where an example would make the claim concrete.",
            )
        ],
        bullet=True,
    )
    + "\n13) title_shape: whether the H1 uses a how-to, number, or year hook and stays under "
    "60 characters. The draft title is the first line.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "When the title is weak, put a sharper title in `suggestion`.",
                "The panel needs an actionable alternative for a weak SERP shape.",
            )
        ],
        bullet=True,
    )
    + "\n14) information_gain: whether the draft adds original information such as "
    "first-party data, a novel case study, or a distinct point of view instead of "
    "re-reporting common knowledge.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag commodity sections and describe first-party detail the author could add "
                "in `suggestion`.",
                "The writer must supply original evidence rather than receive invented data.",
            )
        ],
        bullet=True,
    )
    + "\n15) semantic_triples: whether key claims use standalone subject-verb-object "
    "assertions with concrete named subjects, especially early in paragraphs and bullets.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag key claims buried in subordinate clauses and recast the same claim as a "
                "direct subject-verb-object sentence in `suggestion` without changing its meaning.",
                "A direct alternative must remain faithful to the approved claim.",
            )
        ],
        bullet=True,
    )
    + "\n16) intent_format_match: whether the body structure matches the query archetype "
    "implied by the title, such as a comparative list, numbered how-to, or definition "
    "with questions and answers.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag a mismatch with the expected format in `note` and the structural change "
                "in `suggestion`.",
                "The writer needs both the diagnosed intent and the repair.",
            )
        ],
        bullet=True,
    )
    + "\n17) expert_quotes: whether expert-level claims include named third-party experts "
    "with credentials, distinct from the author's own sound bites.\n"
    + render_prompt_rules(
        [
            PromptRule(
                "Flag unsupported expert-level claims and describe the kind of expert or source "
                "to quote in `suggestion`.",
                "The writer must seek real independent corroboration.",
            )
        ],
        bullet=True,
    )
)

_SEMANTIC_RULES = render_prompt_rules(
    [
        PromptRule(
            "Score the draft without rewriting it.",
            "The analysis panel needs findings against the existing draft.",
        ),
        PromptRule(
            "Score every requested lever from 0 to 100 and explain it briefly.",
            "Comparable scores and concise explanations let the panel rank the findings.",
        ),
        PromptRule(
            "Never invent facts, statistics, brands, sources, data, or quotations.",
            FACTUAL_RATIONALE,
        ),
        PromptRule(
            "Use verbatim draft text for passage-level targets.",
            "The client locates findings by exact text matching.",
        ),
        PromptRule(
            "Omit `target` for document-level findings.",
            "Document-level findings have no exact passage for the client to locate.",
        ),
        PromptRule(
            "Return JSON matching the supplied semantic schema.",
            OUTPUT_RATIONALE,
        ),
        PromptRule(
            "Do not copy the `Rule` or `Because` labels or their rationales into "
            "semantic findings.",
            "Prompt metadata would corrupt fields parsed by the GEO analysis panel.",
        ),
    ]
)


def _clampi(v: Any) -> int:
    try:
        return max(0, min(100, int(v)))
    except (TypeError, ValueError):
        return 0


def parse_semantic(raw: str, draft: Draft) -> dict[str, dict[str, Any]]:
    """Parse the semantic LLM reply into answer_first / definitional_opener /
    factual_density lever dicts. Tolerant of junk; maps weak-section titles to
    ids so the panel can offer a fix."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}

    # Match on the emphasis-stripped, lowercased title so a stored "**ROTATE**"
    # still resolves to the section when the model returns a clean "ROTATE".
    def _key(t: str) -> str:
        return strip_inline_emphasis(t).lower()

    by_title = {_key(s.title): s.id for s in draft.sections}

    def _match_section(raw: str) -> str | None:
        # The model returns section TITLES in weak_sections, but often paraphrases
        # or truncates them, so an exact-title lookup misses and the fix gets
        # dropped. Fall back to substring containment, then best word-overlap
        # (>=2 shared words), so the finding resolves to the right section and
        # stays actionable.
        k = _key(raw)
        if k in by_title:
            return by_title[k]
        for sk, sid in by_title.items():
            if sk and (sk in k or k in sk):
                return sid
        kw = set(k.split())
        best, best_id = 0, None
        for s in draft.sections:
            overlap = len(kw & set(_key(s.title).split()))
            if overlap > best:
                best, best_id = overlap, s.id
        return best_id if best >= 2 else None

    af = data.get("answer_first") if isinstance(data.get("answer_first"), dict) else {}
    weak = af.get("weak_sections") if isinstance(af.get("weak_sections"), list) else []
    af_findings = []
    for title in weak:
        sid = _match_section(str(title))
        clean = strip_inline_emphasis(str(title))
        af_findings.append(
            {
                "section_id": sid or "",
                "note": f'"{clean}" buries its answer — lead with a direct one.',
                "fix": "answer_first" if sid else "",
            }
        )
    answer_first = _lever(
        "answer_first",
        _clampi(af.get("score")),
        str(af.get("note", "")).strip() or "How directly each section answers up front.",
        findings=af_findings,
        fix="answer_first" if af_findings else None,
    )

    do = (
        data.get("definitional_opener") if isinstance(data.get("definitional_opener"), dict) else {}
    )
    do_score = _clampi(do.get("score"))
    # Existence vs execution: only offer to ADD an opener when the model says
    # none exists. A low score with has_definition=True means the definition is
    # badly placed/duplicated — inserting another one made duplicates. Missing
    # field (older/junk replies) defaults to True: never risk a duplicate add.
    has_definition = bool(do.get("has_definition", True))
    # Low score → offer an action so the writer isn't stuck: ADD one if none
    # exists, or IMPROVE (hoist the buried definition into a clean citable line)
    # when one exists but is badly placed.
    if do_score >= 70:
        def_fix = None
    elif has_definition:
        def_fix = "definitional_improve"
    else:
        def_fix = "definitional"
    definitional = _lever(
        "definitional_opener",
        do_score,
        str(do.get("note", "")).strip()
        or "Whether a citable one-liner defines the subject up top.",
        fix=def_fix,
    )

    fd = data.get("factual_density") if isinstance(data.get("factual_density"), dict) else {}
    thin = fd.get("thin_spots") if isinstance(fd.get("thin_spots"), list) else []
    fd_findings = [
        {
            "target": str(t.get("target", "")).strip(),
            "note": str(t.get("note", "")).strip()
            or "Add a real statistic, source, or quote here.",
            "suggestion": str(t.get("suggestion", "")).strip(),
            "impact": str(t.get("impact", "")).strip() or _IMPACTS.get("factual_density", ""),
        }
        for t in thin
        if isinstance(t, dict) and str(t.get("target", "")).strip()
    ]
    # First-hand experience is advisory (no cap): one tested/measured anecdote
    # raises the experience signal engines reward.
    if fd.get("first_hand") is False:
        fd_findings.append(
            {
                "target": "",
                "note": "No first-hand signal — a tested/measured/built anecdote raises "
                "the experience weight engines reward.",
                "suggestion": "Add a result you personally measured or a build decision you made.",
            }
        )
    # Deliberately no `fix`: factual density is flag-only, never auto-filled.
    factual = _lever(
        "factual_density",
        _clampi(fd.get("score")),
        str(fd.get("note", "")).strip()
        or "Specific stats, named sources, and quotes vs. vague claims.",
        findings=fd_findings,
    )

    be = data.get("brand_explicit") if isinstance(data.get("brand_explicit"), dict) else {}
    # Flag-only: naming the brand is the writer's call (and we can't invent one).
    brand = _lever(
        "brand_explicit",
        _clampi(be.get("score")),
        str(be.get("note", "")).strip()
        or "Whether the product/brand is named explicitly so citations travel with it.",
    )

    cit = data.get("citations") if isinstance(data.get("citations"), dict) else {}
    claims = cit.get("uncited_claims") if isinstance(cit.get("uncited_claims"), list) else []
    cit_findings = [
        {
            "target": str(c.get("target", "")).strip(),
            "note": str(c.get("note", "")).strip() or "This claim has no source.",
            "fix": "cite_reference",
            # When the claim matches an attached source, the model returns the
            # rewritten sentence (with the markdown link spliced in) and the
            # source URL — so the client can apply the cite WITHOUT a model call.
            "suggestion": str(c.get("suggestion", "")).strip(),
            "matched_source_url": str(c.get("matched_source_url", "")).strip(),
            "impact": str(c.get("impact", "")).strip() or _IMPACTS.get("citations", ""),
        }
        for c in claims
        if isinstance(c, dict) and str(c.get("target", "")).strip()
    ][:3]
    citations = _lever(
        "citations",
        _clampi(cit.get("score")),
        str(cit.get("note", "")).strip()
        or "Whether concrete claims link to or name their sources.",
        findings=cit_findings,
        fix="cite_reference" if cit_findings else None,
    )

    cov = data.get("coverage") if isinstance(data.get("coverage"), dict) else {}
    missing = (
        cov.get("missing_subquestions") if isinstance(cov.get("missing_subquestions"), list) else []
    )
    coverage = [str(q).strip() for q in missing if str(q).strip()][:4]

    # The eight new levers share one generic shape (score/note/findings) — map
    # them uniformly instead of five more bespoke blocks above.
    new_levers: dict[str, dict[str, Any]] = {}
    for key in _NEW_SEMANTIC_KEYS:
        obj = data.get(key) if isinstance(data.get(key), dict) else {}
        finds: list[dict[str, str]] = []
        for f in (obj.get("findings") or [])[:4]:
            if not isinstance(f, dict) or not str(f.get("note", "")).strip():
                continue
            fd_item = {
                k: str(f.get(k, "")).strip()
                for k in ("target", "note", "suggestion", "impact")
                if str(f.get(k, "")).strip()
            }
            fd_item.setdefault("impact", _IMPACTS.get(key, ""))
            finds.append(fd_item)
        new_levers[key] = _lever(
            key, _clampi(obj.get("score")), str(obj.get("note", "")).strip(), finds
        )

    return {
        "answer_first": answer_first,
        "definitional_opener": definitional,
        "factual_density": factual,
        "brand_explicit": brand,
        "citations": citations,
        **new_levers,
        # Not a lever (build_report/_ORDER ignore unknown keys) — analyze_geo
        # merges these into the structural faq lever as "not covered" advisories.
        "_coverage": coverage,  # type: ignore[dict-item]
    }


def _grade(score: int) -> str:
    if score >= 85:
        return "A"
    if score >= 72:
        return "B"
    if score >= 58:
        return "C"
    if score >= 45:
        return "D"
    return "F"


def build_report(levers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Combine lever dicts into a weighted score + grade + ordered lever list.

    Normalized by the weights actually PRESENT — so a report missing a lever
    (e.g. before a later phase lands, or a partial re-score) isn't diluted by
    that lever's weight; it's the weighted mean of whatever levers are here."""
    present = [(k, w) for k, w in _WEIGHTS.items() if k in levers]
    wsum = sum(w for _, w in present) or 1.0
    score = round(sum(levers[k]["score"] * w for k, w in present) / wsum)
    ordered = [levers[k] for k in _ORDER if k in levers]
    return {"score": score, "grade": _grade(score), "levers": ordered}


# Which levers recompute instantly off the markdown vs. need the LLM pass —
# drives targeted per-lever re-scoring after a fix.
_STRUCTURAL_KEYS = frozenset(
    {
        "question_headings",
        "skimmability",
        "faq",
        "chunking",
        "comparison_table",
        "takeaways",
        "freshness",
        "answer_capsule",
        "page_front_load",
        "definitive_language",
    }
)
_SEMANTIC_KEYS = frozenset(
    {"answer_first", "definitional_opener", "factual_density", "brand_explicit", "citations"}
    | set(_NEW_SEMANTIC_KEYS)
)


async def _run_semantic(
    draft: Draft, pack_root: Path, provider: LLMProvider, *, model: str, extra_sources: str = ""
) -> dict[str, dict[str, Any]]:
    """The single voice-aware LLM pass → the four judgment levers (answer-first,
    definitional opener, factual density, brand), with the deterministic augments
    applied. Shared by the full report and the targeted re-score.

    `extra_sources` carries the voice profile's background-source block so the
    citations lever can match claims against sources the author already
    collected (in addition to the draft's own attached references)."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    # The sources the author has ALREADY collected — the draft's attached
    # references plus the voice profile's background sources. The citations
    # rubric tells the model to match claims against these FIRST, so it stops
    # nagging "no sources cited" when a source is right there to cite. Only refs
    # with a URL are listed: the one-click cite splices a markdown link, so a
    # url-less file/text ref can't be cited this way.
    refs = [r for r in (getattr(draft, "references", None) or []) if r.url]
    ref_lines = "\n".join(f"- {r.name or r.url}: {r.url}" for r in refs)
    sources_block = ""
    if ref_lines or extra_sources:
        sources_block = (
            "\n\nATTACHED SOURCES (already collected by the author):\n"
            f"{ref_lines}\n{extra_sources}\n"
        )
    prompt = (
        f"{system}\n\n---\n\n{_SEMANTIC_DIRECTIVE}\n\n{_SEMANTIC_RULES}\n\n"
        f"SEMANTIC JSON SHAPE:\n{_SEMANTIC_EXAMPLE}{sources_block}\n\nDRAFT:\n"
        f"{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_SEMANTIC_SCHEMA)
    semantic = parse_semantic(resp.text, draft)
    augment_definitional(semantic, draft)
    augment_factual_density(semantic, draft)
    augment_citations(semantic, draft)
    return semantic


async def analyze_geo(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    extra_sources: str = "",
) -> dict[str, Any]:
    """Full GEO report: deterministic structural levers + one semantic LLM pass."""
    structural = score_structural(draft)
    semantic = await _run_semantic(
        draft, pack_root, provider, model=model, extra_sources=extra_sources
    )
    # Sub-question coverage gaps (from the semantic pass) surface as advisory
    # "not covered" findings on the structural FAQ lever — the FAQ fix answers them.
    missing = semantic.pop("_coverage", [])
    if missing and "faq" in structural:
        structural["faq"]["findings"] = [
            *structural["faq"]["findings"],
            *[{"note": f'Not covered: "{q}"', "fix": "faq"} for q in missing],
        ]
    return build_report({**structural, **semantic})


async def rescore_geo(
    draft: Draft,
    keys: list[str],
    pack_root: Path,
    provider: LLMProvider,
    *,
    model: str,
    extra_sources: str = "",
) -> dict[str, dict[str, Any]]:
    """Re-score after a targeted fix. Because a single edit moves collateral
    levers too (adding a citation link shifts factual_density; an answer_first
    rewrite shifts skimmability/chunking/page_front_load), always refresh the
    deterministic structural levers — they're a cheap regex pass with no I/O —
    so the merged total captures that drift for free. Semantic levers still cost
    one LLM pass, so only the explicitly requested ones are re-run.

    faq is the exception: its findings carry semantic sub-question *coverage*
    advisories that only the full analyze_geo pass produces (rescore has no
    coverage data), so it's refreshed only when a FAQ fix explicitly targets it —
    otherwise those advisories would be clobbered until the next Re-analyze."""
    want = {k for k in keys if k in _ORDER}
    out: dict[str, dict[str, Any]] = {}
    structural = score_structural(draft)
    auto_structural = (_STRUCTURAL_KEYS - {"faq"}) | (want & {"faq"})
    out.update({k: structural[k] for k in auto_structural if k in structural})
    if want & _SEMANTIC_KEYS:
        semantic = await _run_semantic(
            draft, pack_root, provider, model=model, extra_sources=extra_sources
        )
        out.update({k: semantic[k] for k in want & _SEMANTIC_KEYS if k in semantic})
    return out


_FAQ_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "faqs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"q": {"type": "string"}, "a": {"type": "string"}},
                "required": ["q", "a"],
            },
        },
    },
    "required": ["faqs"],
}


def parse_faq(raw: str, n: int) -> list[dict[str, str]]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("faqs", []) if isinstance(data, dict) else []
    out: list[dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        q = str(it.get("q", "")).strip()
        a = str(it.get("a", "")).strip()
        if not q or not a:
            continue
        # Defensive: the draft text is sanitized before generation, but never let
        # editorial-marker debris (parked-block brackets or HTML comments) survive
        # into an FAQ answer if the model echoes any.
        if "⟦" in q or "⟦" in a or "<!--" in a:
            continue
        out.append({"q": q, "a": a})
    return out[:n]


async def generate_faq(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    n: int = 4,
    questions: list[str] | None = None,
) -> list[dict[str, str]]:
    """Generate grounded FAQ pairs from the draft, in the author's voice. When
    `questions` are given (e.g. the sub-question coverage gaps), answer EXACTLY
    those the draft can support — never guessing at ones it can't."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    if questions:
        task = (
            "Create FAQ entries for these supplied reader questions:\n"
            + "\n".join(f"- {q.strip()}" for q in questions if q.strip())
        )
        requested_rules = [
            PromptRule(
                "Answer exactly the supplied reader questions.",
                "The coverage fix must address the questions the writer selected.",
            ),
            PromptRule(
                "Skip any supplied question the draft cannot support.",
                "Guessing would turn a coverage fix into unsupported content.",
            ),
        ]
    else:
        task = "Create FAQ entries that a reader of this post would naturally ask."
        requested_rules = [
            PromptRule(
                f"Write {n} real reader questions of the kind heard on sales calls or in "
                "People Also Ask.",
                "The FAQ should address likely reader needs rather than generic filler.",
            )
        ]
    rules = render_prompt_rules(
        [
            *requested_rules,
            PromptRule(
                "Base every question and answer only on the draft.",
                FACTUAL_RATIONALE,
            ),
            PromptRule(
                "Keep each answer to 2-3 concise sentences that stand alone.",
                "FAQ answers may be extracted independently from the surrounding post.",
            ),
            PromptRule(
                "Stay in the author's voice.",
                VOICE_RATIONALE,
            ),
            PromptRule(
                "Never use banished words or phrases.",
                "Those terms conflict with the author's established voice and "
                "explicit preferences.",
            ),
            PromptRule("Return JSON matching the FAQ schema.", OUTPUT_RATIONALE),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "FAQ fields.",
                "Prompt metadata would corrupt fields parsed by the FAQ editor.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\nTASK:\n{task}\n\n{rules}\n\n"
        'FAQ JSON SHAPE:\n{"faqs": [{"q": "...", "a": "..."}]}\n\nDRAFT:\n'
        f"{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_FAQ_SCHEMA)
    return parse_faq(resp.text, len(questions) if questions else n)


def clean_opener(raw: str) -> str:
    """Reduce the model's reply to one plain sentence: strip quotes/headings and
    keep only the first line with content."""
    line = next((ln.strip() for ln in raw.strip().splitlines() if ln.strip()), "")
    return line.strip("\"'`“”").lstrip("#").strip()


async def generate_opener(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
) -> str:
    """One citable definitional sentence for the top of the post, in voice.

    Generated from the draft itself (not spliced by rewriting a whole section),
    so the client can prepend it verbatim — and remove exactly it on undo.
    """
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    rules = render_prompt_rules(
        [
            PromptRule(
                "Write exactly one sentence.",
                "The client prepends the result as one opening sentence.",
            ),
            PromptRule(
                "Define the subject, its category, and what it does or argues.",
                "This sentence is the post's citable definitional opener.",
            ),
            PromptRule(
                "Adapt the definition naturally to the author's voice.",
                VOICE_RATIONALE,
            ),
            PromptRule(
                "Ground the sentence only in the draft and invent nothing.",
                FACTUAL_RATIONALE,
            ),
            PromptRule(
                "Return only the sentence, with no quotes, heading, or explanation.",
                "The client prepends this response verbatim.",
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "the sentence.",
                "The client prepends this response verbatim as clean article prose.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\nTASK:\nCreate a citable definitional opener for this post. "
        'A useful pattern is "<Subject> is a <category> that <differentiator>".\n\n'
        f"{rules}\n\nDRAFT:\n{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt)
    return clean_opener(resp.text)


def clean_table(raw: str) -> str:
    """Reduce the model's reply to just the Markdown table: the contiguous run of
    pipe rows including the ``|---|`` separator. Empty string if no valid table
    came back (so the caller can surface an error instead of pasting prose)."""
    block = "\n".join(ln.rstrip() for ln in raw.strip().splitlines() if "|" in ln).strip()
    if _TABLE_ROW_RE.search(block) and _TABLE_SEP_RE.search(block):
        return block
    return ""


async def generate_table(
    draft: Draft,
    section_id: str,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
) -> str:
    """Turn one section's prose comparison into a grounded Markdown table.

    Columns are the dimensions compared, rows the options (or vice-versa); every
    cell is drawn from the section's own text — no invented facts or options.
    Returns the table markdown for the client to splice in, or "" on failure.
    """
    from blogforge.voice import compose_prompt

    section = next((s for s in draft.sections if s.id == section_id), None)
    if section is None or not section.content_md.strip():
        return ""
    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    rules = render_prompt_rules(
        [
            PromptRule(
                "Represent the comparison as one compact Markdown table, with comparison "
                "dimensions as columns and options as rows, or vice versa when clearer.",
                "The table should make the section's existing comparison easier to scan.",
            ),
            PromptRule(
                "Use only facts, numbers, and options stated in the source section.",
                FACTUAL_RATIONALE,
            ),
            PromptRule(
                "Keep the author's terminology.",
                "Changed labels could alter the section's intended distinctions.",
            ),
            PromptRule(
                "Include a header row, a Markdown separator row, and data rows.",
                "The table parser requires valid Markdown table structure.",
            ),
            PromptRule(
                "Return only one valid Markdown table, with no title or prose.",
                "The client splices this response directly into the source section.",
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "the Markdown table.",
                "Prompt metadata would invalidate content spliced directly into "
                "the source section.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\nTASK:\nTurn the source section's prose comparison into a "
        f"table.\n\n{rules}\n\nSECTION: {strip_inline_emphasis(section.title)}\n\n"
        f"{section.content_md}"
    )
    resp = await provider.complete(model=model, prompt=prompt)
    return clean_table(resp.text)


_QUOTES_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"quotes": {"type": "array", "items": {"type": "string"}}},
    "required": ["quotes"],
}


def verbatim_quotes(raw: str, source: str, limit: int = 3) -> list[str]:
    """Keep only model-returned quotes that appear EXACTLY in the source text —
    the honesty guard so the citations fix can never fabricate a quotation."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("quotes", []) if isinstance(data, dict) else []
    out = [q.strip() for q in items if isinstance(q, str) and q.strip() and q.strip() in source]
    return out[:limit]


async def generate_quotes(
    reference_text: str,
    provider: LLMProvider,
    *,
    model: str,
) -> list[str]:
    """2-3 VERBATIM quote candidates from a reference's extracted text. The model
    is told to copy exactly; `verbatim_quotes` drops anything it didn't."""
    rules = render_prompt_rules(
        [
            PromptRule(
                "Select 2-3 passages of one or two sentences and fewer than 60 words each.",
                "The citation picker needs a short, usable set of compact quotations.",
            ),
            PromptRule(
                "Choose passages that would strongly support an article.",
                "The writer needs quotations that add relevant evidence.",
            ),
            PromptRule(
                "Copy every selected passage exactly, character for character.",
                "Changed wording would falsely attribute words to the source.",
            ),
            PromptRule(
                "Do not paraphrase, trim words, or fix punctuation.",
                "Even small edits would make the result no longer verbatim.",
            ),
            PromptRule("Return JSON matching the quotations schema.", OUTPUT_RATIONALE),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "quotation fields.",
                "Prompt metadata would corrupt quotations parsed by the citation picker.",
            ),
        ]
    )
    prompt = (
        "TASK:\nSelect supporting quotation candidates from the source text.\n\n"
        f"{rules}\n\nQUOTATIONS JSON SHAPE:\n"
        '{"quotes": ["..."]}\n\nSOURCE:\n' + reference_text[:20000]
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_QUOTES_SCHEMA)
    return verbatim_quotes(resp.text, reference_text)


_TAKEAWAYS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"takeaways": {"type": "array", "items": {"type": "string"}}},
    "required": ["takeaways"],
}


def parse_takeaways(raw: str, limit: int = 5) -> list[str]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("takeaways", []) if isinstance(data, dict) else []
    out = [" ".join(str(t).split()).strip() for t in items if isinstance(t, str) and str(t).strip()]
    return out[:limit]


async def generate_takeaways(
    draft: Draft,
    pack_root: Path,
    provider: LLMProvider,
    *,
    model: str,
) -> list[str]:
    """3-5 grounded one-line key takeaways (TL;DR) from the draft, in voice."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    rules = render_prompt_rules(
        [
            PromptRule(
                "Write 3-5 one-line takeaways.",
                "The key-takeaways block needs a compact summary rather than another section.",
            ),
            PromptRule(
                "Ground every takeaway strictly in the draft and invent nothing.",
                FACTUAL_RATIONALE,
            ),
            PromptRule(
                "Make every takeaway concrete.",
                "A useful takeaway gives the reader a specific point from the post.",
            ),
            PromptRule(
                "Make every takeaway stand alone.",
                "Each bullet may be extracted independently from the surrounding post.",
            ),
            PromptRule(
                "Write every takeaway in the author's voice.",
                VOICE_RATIONALE,
            ),
            PromptRule(
                "Never use banished words or phrases.",
                VOICE_RATIONALE,
            ),
            PromptRule("Return JSON matching the takeaways schema.", OUTPUT_RATIONALE),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "takeaway fields.",
                "Prompt metadata would corrupt takeaways parsed into article bullets.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\nTASK:\nCreate the key takeaways for this post.\n\n{rules}\n\n"
        'TAKEAWAYS JSON SHAPE:\n{"takeaways": ["..."]}\n\nDRAFT:\n'
        f"{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_TAKEAWAYS_SCHEMA)
    return parse_takeaways(resp.text)


async def generate_alt_text(
    target: str,
    section_text: str,
    provider: LLMProvider,
    *,
    model: str,
) -> str:
    """One concise descriptive alt text (<120 chars) for an image, from context.
    The client splices it into the image markdown's empty alt slot."""
    rules = render_prompt_rules(
        [
            PromptRule(
                "Describe only what the image context supports.",
                FACTUAL_RATIONALE,
            ),
            PromptRule(
                "Keep the alt text under 120 characters.",
                "Concise descriptions are easier for screen-reader users to understand.",
            ),
            PromptRule(
                "Do not begin with boilerplate such as 'Image of' or 'Picture of'.",
                "Screen readers already announce that the element is an image.",
            ),
            PromptRule(
                "Return only the alt text, with no quotes or explanation.",
                "The client inserts this response directly into the image's alt-text slot.",
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "the alt text.",
                "The client inserts this response directly into the image's alt-text slot.",
            ),
        ]
    )
    prompt = (
        "TASK:\nWrite descriptive alt text for the image using its surrounding section.\n\n"
        f"{rules}\n\nIMAGE MARKDOWN: {target}\n\nSECTION:\n{section_text[:4000]}"
    )
    resp = await provider.complete(model=model, prompt=prompt)
    return " ".join(resp.text.strip().strip("\"'`").split())[:120]


_QUERIES_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"queries": {"type": "array", "items": {"type": "string"}}},
    "required": ["queries"],
}


def parse_queries(raw: str, limit: int = 10) -> list[str]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("queries", []) if isinstance(data, dict) else []
    out = [" ".join(str(q).split()).strip() for q in items if isinstance(q, str) and str(q).strip()]
    return out[:limit]


async def generate_queries(
    draft: Draft,
    pack_root: Path,
    provider: LLMProvider,
    *,
    model: str,
) -> list[str]:
    """6-10 natural-language queries this post should be the canonical answer for
    — grounded in its title/headings/FAQ, for the writer's manual citation checks."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    rules = render_prompt_rules(
        [
            PromptRule(
                "Return 6-10 natural-language search queries.",
                "The citation-check workflow needs a focused but useful query set.",
            ),
            PromptRule(
                "Phrase queries like requests typed into ChatGPT, Perplexity, or Google.",
                "The writer will use these strings for manual answer-engine checks.",
            ),
            PromptRule(
                "Include only topics the post actually covers.",
                FACTUAL_RATIONALE,
            ),
            PromptRule(
                "Ground the queries in the post's title, headings, and FAQ.",
                "Those elements define the draft's actual search intent.",
            ),
            PromptRule("Return JSON matching the queries schema.", OUTPUT_RATIONALE),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "query fields.",
                "Prompt metadata would corrupt queries parsed by the citation-check workflow.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\nTASK:\nCreate queries for which this post should be the "
        f"definitive answer.\n\n{rules}\n\n"
        'QUERIES JSON SHAPE:\n{"queries": ["..."]}\n\nDRAFT:\n'
        f"{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_QUERIES_SCHEMA)
    return parse_queries(resp.text)


async def generate_citation(
    passage: str,
    ref_name: str,
    ref_url: str | None,
    pack_root: Path,
    provider: LLMProvider,
    *,
    model: str,
    quote: str | None = None,
) -> str:
    """Rewrite one passage to attribute (and, when available, link) a reference —
    the cite_reference / quote_reference fix. Nothing beyond the attribution is
    invented; the client splices the result over the original passage."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    source_context = f'SOURCE NAME: "{ref_name}"'
    if ref_url:
        source_context += f"\nSOURCE URL FOR MARKDOWN ATTRIBUTION: {ref_url}"
    if quote:
        source_context += f'\nOPTIONAL VERBATIM QUOTATION: "{quote}"'
    rules = render_prompt_rules(
        [
            PromptRule(
                "Add only the requested source attribution and optional supplied quotation.",
                "This is a bounded citation edit, not permission to rewrite the passage.",
            ),
            PromptRule(
                "Attribute the claim in the author's voice.",
                VOICE_RATIONALE,
            ),
            PromptRule(
                "Use the supplied URL as a Markdown link when present.",
                "The rewritten passage needs a clickable attribution to the requested source.",
            ),
            PromptRule(
                "Do not change the passage's meaning or invent information.",
                PRESERVATION_RATIONALE,
            ),
            PromptRule(
                "Preserve a supplied quotation verbatim.",
                "A changed quotation would falsely attribute words to the source.",
            ),
            PromptRule(
                "Place a supplied quotation in quotation marks.",
                "Quotation marks distinguish the source's words from the author's passage.",
            ),
            PromptRule(
                "Return only the rewritten passage.",
                "The client replaces the selected passage with this response.",
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "the rewritten passage.",
                "The client replaces the selected passage with this response.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\nTASK:\nAdd source attribution to the passage.\n\n"
        f"{source_context}\n\n{rules}\n\nPASSAGE:\n{passage}"
    )
    resp = await provider.complete(model=model, prompt=prompt)
    return resp.text.strip()


def lever_catalog() -> list[dict[str, object]]:
    """All GEO levers, in display order, for the help page — key/label/weight/
    impact plus how each is detected: "judgment" (LLM semantic pass) vs
    "structural" (deterministic regex/markdown check)."""
    semantic = set(_SEMANTIC_KEYS)
    return [
        {
            "key": k,
            "label": _LABELS[k],
            "weight": _WEIGHTS[k],
            "impact": _IMPACTS.get(k, ""),
            "detection": "judgment" if k in semantic else "structural",
        }
        for k in _ORDER
    ]
