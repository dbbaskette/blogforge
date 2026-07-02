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
# carry the most. Deterministic and semantic levers share one scale.
_WEIGHTS: dict[str, float] = {
    "answer_first": 0.20,
    "factual_density": 0.20,
    "definitional_opener": 0.10,
    "question_headings": 0.10,
    "skimmability": 0.10,
    "brand_explicit": 0.08,
    "comparison_table": 0.06,
    "faq": 0.08,
    "chunking": 0.08,
}
# Display order in the panel (roughly by leverage).
_ORDER = (
    "answer_first",
    "factual_density",
    "definitional_opener",
    "brand_explicit",
    "question_headings",
    "skimmability",
    "comparison_table",
    "chunking",
    "faq",
)
_LABELS: dict[str, str] = {
    "answer_first": "Answer-first sections",
    "factual_density": "Factual density",
    "definitional_opener": "Definitional opener",
    "brand_explicit": "Brand named explicitly",
    "question_headings": "Question headings",
    "skimmability": "Skimmability",
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
_BACKREF_RE = re.compile(
    r"(?i)\bas (?:mentioned|noted|discussed|described|explained|shown|we saw) "
    r"(?:above|earlier|previously|below)\b|\bin the (?:previous|next|preceding) section\b"
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


def _longest_paragraph_chars(text: str) -> int:
    return len(_longest_paragraph(text))


def _draft_text(draft: Draft) -> str:
    parts = [f"# {draft.title or draft.idea.topic}"]
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
    if not has_list:
        sk_score = 40.0
        sk_detail = "No lists or tables — add bullets, numbered steps, or a comparison table."
    else:
        sk_score = max(50.0, 100 - 15 * len(walls))
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
        ],
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
    ch_findings = backrefs + [
        {
            "section_id": s.id,
            "note": f'"{strip_inline_emphasis(s.title)}" is long ({s.word_count} words) — split it '
            "into two sections with their own headings so each chunk stands alone.",
        }
        for s in longsecs
    ]
    chunk = _lever(
        "chunking",
        max(40, 100 - 10 * len(backrefs) - 10 * len(longsecs)),
        "Passages stand on their own."
        if not ch_findings
        else f"{len(backrefs)} back-reference(s), {len(longsecs)} over-long section(s).",
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

    return {
        "question_headings": question,
        "skimmability": skim,
        "faq": faq,
        "chunking": chunk,
        "comparison_table": comparison,
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
    },
    "required": ["answer_first", "definitional_opener", "factual_density", "brand_explicit"],
}

_SEMANTIC_DIRECTIVE = (
    "Evaluate this draft on three Generative-Engine-Optimization dimensions. Score "
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
    "describe what to add.\n"
    "4) brand_explicit: does the post name its product/brand/subject EXPLICITLY and "
    "clearly (not just implied), ideally near the top? AI can cite content without "
    "naming the source ('ghost citation'); an explicit brand name travels with the "
    "citation. Put the brand you detect in `brand`, set `stated_up_top` true if it "
    "appears in the first section, and score how clearly/early it's named. Never "
    "invent a brand — if none is evident, say so in `note` and score low."
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

    return {
        "answer_first": answer_first,
        "definitional_opener": definitional,
        "factual_density": factual,
        "brand_explicit": brand,
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
    """Combine lever dicts into a weighted score + grade + ordered lever list."""
    total = sum(levers[k]["score"] * w for k, w in _WEIGHTS.items() if k in levers)
    score = round(total)
    ordered = [levers[k] for k in _ORDER if k in levers]
    return {"score": score, "grade": _grade(score), "levers": ordered}


async def analyze_geo(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
) -> dict[str, Any]:
    """Full GEO report: deterministic structural levers + one semantic LLM pass."""
    from blogforge.voice import compose_prompt

    structural = score_structural(draft)
    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    prompt = (
        f"{system}\n\n---\n\n{_SEMANTIC_DIRECTIVE}\n\n"
        'Return JSON matching: {"answer_first": {"score": 0, "note": "", '
        '"weak_sections": []}, "definitional_opener": {"score": 0, "note": "", '
        '"has_definition": false}, '
        '"factual_density": {"score": 0, "note": "", "has_stats": false, '
        '"has_named_sources": false, "has_quotes": false, "thin_spots": []}, '
        '"brand_explicit": {"score": 0, "note": "", "brand": "", '
        '"stated_up_top": false}}.\n\nDRAFT:\n'
        f"{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_SEMANTIC_SCHEMA)
    semantic = parse_semantic(resp.text, draft)
    levers = {**structural, **semantic}
    augment_definitional(levers, draft)
    augment_factual_density(levers, draft)
    return build_report(levers)


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
) -> list[dict[str, str]]:
    """Generate ``n`` grounded FAQ pairs from the draft, in the author's voice."""
    from blogforge.voice import compose_prompt

    system = compose_prompt(pack_root, format=None, samples=None, draft=None)
    prompt = (
        f"{system}\n\n---\n\nWrite {n} FAQ entries a reader of THIS post would ask, "
        "answered from the post's own content — real questions (the kind from sales "
        "calls or 'People Also Ask'), concise answers (2-3 sentences) that stand "
        "alone. Ground every answer in the draft; invent no facts. Stay in the "
        'author\'s voice; banished words never appear. Return JSON: {"faqs": '
        '[{"q": "...", "a": "..."}]}.\n\nDRAFT:\n'
        f"{_draft_text(draft)}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_FAQ_SCHEMA)
    return parse_faq(resp.text, n)


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
