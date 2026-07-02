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

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from blogforge.drafts.models import Draft
from blogforge.generate.textutil import strip_inline_emphasis
from blogforge.llm.base import LLMProvider

# Weights sum to 1.0; the two most-cited levers (answer-first, factual density)
# carry the most, with citations — the strongest researched lever — right after.
# build_report normalizes by the weights actually PRESENT, so levers can land
# across phases without deflating the total.
_WEIGHTS: dict[str, float] = {
    "answer_first": 0.16,
    "factual_density": 0.16,
    "citations": 0.10,
    "definitional_opener": 0.08,
    "question_headings": 0.08,
    "skimmability": 0.08,
    "brand_explicit": 0.06,
    "faq": 0.06,
    "chunking": 0.06,
    "takeaways": 0.06,
    "freshness": 0.06,
    "comparison_table": 0.04,
}
# Display order in the panel (roughly by leverage).
_ORDER = (
    "answer_first",
    "factual_density",
    "citations",
    "definitional_opener",
    "takeaways",
    "brand_explicit",
    "question_headings",
    "skimmability",
    "freshness",
    "comparison_table",
    "chunking",
    "faq",
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
    opening = draft.outline.opening_hook.strip() if draft.outline else ""
    if opening:
        parts.append(opening)
    for s in draft.sections:
        body = s.content_md.strip()
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

    return {
        "question_headings": question,
        "skimmability": skim,
        "faq": faq,
        "chunking": chunk,
        "comparison_table": comparison,
        "takeaways": takeaways,
        "freshness": freshness,
    }


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
    ],
}

_SEMANTIC_DIRECTIVE = (
    "Evaluate this draft on five Generative-Engine-Optimization dimensions. Score "
    "each 0-100 and explain briefly. Do NOT rewrite anything.\n"
    "1) answer_first: does each section OPEN with a direct, self-contained answer "
    "(40-60 words) before context? List the titles of sections that bury the answer "
    "in `weak_sections`.\n"
    "2) definitional_opener: does the piece open with a clear, citable one-line "
    "definition of its subject/thesis? Set `has_definition` true if such a "
    "sentence EXISTS anywhere near the top (even if badly placed, duplicated, or "
    "buried) — the score reflects execution; `has_definition` reflects existence. "
    "This decides whether the tool offers to ADD one: adding on top of an "
    "existing definition creates duplicates.\n"
    "3) factual_density: does it use specific statistics, named sources, and quotes "
    "rather than vague claims? Set `has_stats`, `has_named_sources`, and `has_quotes` "
    "to reflect which of the three are present, and in `note` name which are MISSING "
    "(this is the single best-proven citation lever). In `thin_spots`, quote vague "
    "passages that WOULD be stronger with real data; in each `note` name the problem, "
    "and in `suggestion` say concretely WHAT KIND of data to add and where they'd find "
    'it (e.g. "Add your actual deployment count or a p95 latency benchmark from your '
    'monitoring"). You CANNOT invent facts — never supply statistics or sources, only '
    "describe what to add. Also set `first_hand` true if the author shows first-hand "
    "experience ('we tested', 'I built', a result they measured) — engines weight "
    "first-hand experience heavily.\n"
    "4) brand_explicit: does the post name its product/brand/subject EXPLICITLY and "
    "clearly (not just implied), ideally near the top? AI can cite content without "
    "naming the source ('ghost citation'); an explicit brand name travels with the "
    "citation. Put the brand you detect in `brand`, set `stated_up_top` true if it "
    "appears in the first section, and score how clearly/early it's named. Never "
    "invent a brand — if none is evident, say so in `note` and score low.\n"
    "5) citations: do concrete, checkable claims carry a source — a named origin "
    "or an outbound link? Score how well claims are attributed. In `uncited_claims` "
    "quote up to 3 passages that assert something checkable with no source; in each "
    "`note` say what kind of source would back it. Never invent sources.\n"
    "Finally, in `coverage.missing_subquestions` list up to 4 natural sub-questions "
    "of this topic a search engine would decompose the query into that this draft "
    "does NOT answer — only questions genuinely in-scope for the title."
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

    af = data.get("answer_first") if isinstance(data.get("answer_first"), dict) else {}
    weak = af.get("weak_sections") if isinstance(af.get("weak_sections"), list) else []
    af_findings = []
    for title in weak:
        sid = by_title.get(_key(str(title)))
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

    return {
        "answer_first": answer_first,
        "definitional_opener": definitional,
        "factual_density": factual,
        "brand_explicit": brand,
        "citations": citations,
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
    }
)
_SEMANTIC_KEYS = frozenset(
    {"answer_first", "definitional_opener", "factual_density", "brand_explicit", "citations"}
)


async def _run_semantic(
    draft: Draft, pack_root: Path, provider: LLMProvider, *, model: str
) -> dict[str, dict[str, Any]]:
    """The single voice-aware LLM pass → the four judgment levers (answer-first,
    definitional opener, factual density, brand), with the deterministic augments
    applied. Shared by the full report and the targeted re-score."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    prompt = (
        f"{system}\n\n---\n\n{_SEMANTIC_DIRECTIVE}\n\n"
        'Return JSON matching: {"answer_first": {"score": 0, "note": "", '
        '"weak_sections": []}, "definitional_opener": {"score": 0, "note": "", '
        '"has_definition": false}, '
        '"factual_density": {"score": 0, "note": "", "has_stats": false, '
        '"has_named_sources": false, "has_quotes": false, "first_hand": false, '
        '"thin_spots": []}, '
        '"brand_explicit": {"score": 0, "note": "", "brand": "", '
        '"stated_up_top": false}, '
        '"citations": {"score": 0, "note": "", "uncited_claims": []}, '
        '"coverage": {"missing_subquestions": []}}.\n\nDRAFT:\n'
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
) -> dict[str, Any]:
    """Full GEO report: deterministic structural levers + one semantic LLM pass."""
    structural = score_structural(draft)
    semantic = await _run_semantic(draft, pack_root, provider, model=model)
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
) -> dict[str, dict[str, Any]]:
    """Re-score ONLY the requested levers after a targeted fix. Structural levers
    recompute instantly (no LLM); semantic levers need one LLM pass. Everything
    else is left untouched — so applying a fix refreshes just that part, not the
    whole document."""
    want = {k for k in keys if k in _ORDER}
    out: dict[str, dict[str, Any]] = {}
    if want & _STRUCTURAL_KEYS:
        structural = score_structural(draft)
        out.update({k: structural[k] for k in want & _STRUCTURAL_KEYS if k in structural})
    if want & _SEMANTIC_KEYS:
        semantic = await _run_semantic(draft, pack_root, provider, model=model)
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
        if q and a:
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
        ask = (
            "Answer EXACTLY these reader questions from the post's own content — SKIP "
            "any the draft cannot answer (do not guess): "
            + "; ".join(q.strip() for q in questions if q.strip())
        )
    else:
        ask = (
            f"Write {n} FAQ entries a reader of THIS post would ask, answered from the "
            "post's own content — real questions (the kind from sales calls or 'People "
            "Also Ask')"
        )
    prompt = (
        f"{system}\n\n---\n\n{ask}. Concise answers (2-3 sentences) that stand alone. "
        "Ground every answer in the draft; invent no facts. Stay in the author's "
        'voice; banished words never appear. Return JSON: {"faqs": '
        '[{"q": "...", "a": "..."}]}.\n\nDRAFT:\n'
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
    prompt = (
        f"{system}\n\n---\n\nWrite ONE citable opening sentence for this post that "
        "defines its subject: what it is, what category it belongs to, and what it "
        'does or argues — the pattern "<Subject> is a <category> that <differentiator>", '
        "adapted naturally to the author's voice. Ground it in the draft; invent "
        "nothing. Return ONLY the sentence — no quotes, no heading, no explanation.\n\n"
        f"DRAFT:\n{_draft_text(draft)}"
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
    prompt = (
        f"{system}\n\n---\n\nThe section below compares options/versions/tradeoffs in "
        "prose. Turn that comparison into ONE compact Markdown table: columns are the "
        "dimensions being compared, rows are the options (or vice-versa if that reads "
        "better). Use ONLY facts, numbers, and options already in the section — invent "
        "nothing and keep the author's terms. Return ONLY the Markdown table (a header "
        "row, a |---| separator row, then the data rows) — no title, no prose.\n\n"
        f"SECTION: {strip_inline_emphasis(section.title)}\n\n{section.content_md}"
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
    prompt = (
        "From the source text below, select 2-3 short passages (one or two "
        "sentences each, under 60 words) that would make strong supporting quotes "
        "for an article. Copy them EXACTLY, character for character — do not "
        "paraphrase, trim words, or fix punctuation. Return JSON: "
        '{"quotes": ["..."]}.\n\nSOURCE:\n' + reference_text[:20000]
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
    prompt = (
        f"{system}\n\n---\n\nWrite 3-5 key takeaways for this post — one line each, "
        "concrete, each standing alone (a reader who sees ONLY the bullet learns "
        "something true from this post). Ground every bullet strictly in the draft; "
        "invent nothing. Stay in the author's voice; banished words never appear. "
        'Return JSON: {"takeaways": ["..."]}.\n\nDRAFT:\n'
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
    prompt = (
        "Write one concise, descriptive alt text (under 120 characters) for an image "
        "in the section below. Describe what the image most likely shows given the "
        "surrounding prose. Return ONLY the alt text — no quotes, no 'Image of'.\n\n"
        f"IMAGE MARKDOWN: {target}\n\nSECTION:\n{section_text[:4000]}"
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
    prompt = (
        f"{system}\n\n---\n\nList 6-10 natural-language search queries (the kind typed "
        "into ChatGPT, Perplexity, or Google) for which this post should be the "
        "definitive answer. Ground them in the post's actual title, headings, and FAQ "
        "— no aspirational topics it does not cover. Return JSON: "
        '{"queries": ["..."]}.\n\nDRAFT:\n'
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
    link = f", linked as a Markdown link to {ref_url}" if ref_url else ""
    quote_clause = (
        f' Weave in this VERBATIM quote from the source, in quotation marks: "{quote}".'
        if quote
        else ""
    )
    prompt = (
        f"{system}\n\n---\n\nRewrite the passage below so it attributes its claim to "
        f'the named source, in the author\'s voice: source name "{ref_name}"{link}.'
        f"{quote_clause} Do not change the passage's meaning and do not invent "
        "anything beyond the attribution. Return only the rewritten passage.\n\n"
        f"PASSAGE:\n{passage}"
    )
    resp = await provider.complete(model=model, prompt=prompt)
    return resp.text.strip()
