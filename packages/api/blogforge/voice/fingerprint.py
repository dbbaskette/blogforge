"""Stylometric stats for the Voice Fingerprint card — pure + deterministic.

Computes the cheap, exact parts of a "voiceprint" from the user's writing
samples: sentence-length rhythm, recurring signature phrases, and a top-words
vocabulary signature. The subjective tonal dimensions (casual/vivid/…) are
scored by an LLM in the API layer; this module stays dependency-free + testable.
"""
from __future__ import annotations

import re
from collections import Counter

_STOP = frozenset(
    """a an and the of to in on at for with as is are was were be been being by it its
    this that these those i we you he she they them his her our your my me us him then
    so but or if not no yes do does did have has had will would can could should may
    might must from into out up down over under again more most some any all each every
    about than too very just like get got one two three what which who when where why how
    there here their theirs ours yours mine he's she's it's i'm we're you're they're""".split()
)
_WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")
_SENT = re.compile(r"(?<=[.!?])\s+")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text) if s.strip()]


def compute_stats(sample_texts: list[str]) -> dict:
    """Deterministic stylometry from the user's sample texts."""
    text = "\n".join(t for t in sample_texts if t and t.strip())
    sents = _sentences(text)
    lengths = [len(_WORD.findall(s)) for s in sents]
    lengths = [n for n in lengths if n > 0]
    # Rhythm: the last ~18 sentence lengths (capped so the sparkline scales).
    rhythm = [min(n, 40) for n in lengths[-18:]]

    words = [w.lower() for w in _WORD.findall(text)]
    content = [w for w in words if w not in _STOP and len(w) > 2]
    top_words = [w for w, _ in Counter(content).most_common(8)]

    # Signature phrases: 2–3 word n-grams that recur and aren't all stopwords.
    grams: Counter[str] = Counter()
    for n in (3, 2):
        for i in range(len(words) - n + 1):
            gram = words[i : i + n]
            if all(g in _STOP for g in gram):
                continue
            if gram[0] in _STOP and gram[-1] in _STOP:
                continue
            grams[" ".join(gram)] += 1
    phrases = [p for p, c in grams.most_common(40) if c >= 2][:5]

    return {
        "rhythm": rhythm,
        "top_words": top_words,
        "signature_phrases": phrases,
        "word_count": len(words),
        "avg_sentence_len": round(sum(lengths) / len(lengths), 1) if lengths else 0.0,
    }


def render_fingerprint_md(sample_texts: list[str]) -> str:
    """Render compute_stats() as prompt-ready guidance. Deterministic."""
    s = compute_stats(sample_texts)
    lengths = s["rhythm"]
    short = sum(1 for n in lengths if n < 10)
    longn = sum(1 for n in lengths if n > 25)
    mix = (
        f"about {round(100 * short / len(lengths))}% of sentences run under 10 words "
        f"and {round(100 * longn / len(lengths))}% over 25"
        if lengths else "not enough sample text to measure rhythm"
    )
    phrases = "".join(f'\n- "{p}"' for p in s["signature_phrases"]) or "\n- (none found)"
    words = ", ".join(s["top_words"]) or "(none)"
    return (
        "## Voice fingerprint (measured from the author's samples)\n\n"
        f"- Sentence rhythm: average {s['avg_sentence_len']} words; {mix}. "
        "Match this distribution — do not flatten to uniform mid-length sentences.\n"
        f"- Signature phrases the author actually uses (reach for these when natural, "
        f"never force them):{phrases}\n"
        f"- Characteristic vocabulary: {words}.\n"
    )


def select_exemplars(sample_texts: list[str], k: int = 3, max_chars: int = 300) -> list[str]:
    """Short verbatim excerpts from distinct samples — the opening run of each
    of the k longest samples, cut at a sentence boundary under max_chars."""
    ranked = sorted(
        (t.strip() for t in sample_texts if t and t.strip()),
        key=len,
        reverse=True,
    )[:k]
    out: list[str] = []
    for t in ranked:
        cut = t[:max_chars]
        matches = list(re.finditer(r"[.!?]", cut))
        out.append(cut[: matches[-1].end()] if matches else cut)
    return out
