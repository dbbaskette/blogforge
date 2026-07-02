"""Repurpose a finished draft into a different channel — in the author's voice.

One blog → an X thread, a LinkedIn post, a newsletter blurb, a TL;DR, an SEO
meta description, or an announcement email. Operates on the assembled markdown
of the whole post (not a fragment) and returns the repurposed text
synchronously via provider.complete(); these outputs are short.

Voice setup mirrors section generation (same compose_prompt path) so the
repurposed copy reads like the same author wrote it for the new channel.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.generate.formats import resolve_format
from blogforge.llm.base import LLMProvider

RepurposeFormat = Literal[
    "x_thread", "linkedin", "linkedin_article", "newsletter", "tldr", "meta_description", "email"
]

# label is for the UI; directive is the channel-specific instruction.
FORMATS: dict[str, dict[str, str]] = {
    "x_thread": {
        "label": "X / Twitter thread",
        "directive": (
            "Turn the post into an X (Twitter) thread. Open with a scroll-stopping "
            "hook tweet, then 4-8 numbered tweets that carry the argument. Each tweet "
            "stands alone and stays under 280 characters. Number them like 1/, 2/. "
            "No hashtags unless they're genuinely useful."
        ),
    },
    "linkedin": {
        "label": "LinkedIn post (feed)",
        "directive": (
            "Turn the post into a LinkedIn FEED post of 50-299 words (don't pad it to "
            "look longer — short posts get cited as often). A strong first line (the "
            "only part shown before 'see more'), short punchy paragraphs with line "
            "breaks, and one concrete thing the reader LEARNS — teach, don't just "
            "announce. Name the product/brand explicitly at least once so a citation "
            "travels with it. End with a soft prompt for discussion. No buzzword soup."
        ),
    },
    "linkedin_article": {
        "label": "LinkedIn article (Pulse)",
        "directive": (
            "Turn the post into a long-form LinkedIn (Pulse) ARTICLE of 800-1,200 words "
            "— Pulse articles get cited by AI far more often than feed posts. Keep a "
            "clear title, short teaching sections with subheadings, and at least one "
            "concrete takeaway per section. Lead with substance the reader can act on "
            "(instruct, don't announce), name the product/brand explicitly, and keep it "
            "original and first-hand. Return the article body in Markdown."
        ),
    },
    "newsletter": {
        "label": "Newsletter blurb",
        "directive": (
            "Write a short newsletter intro (90-150 words) that teases the post and "
            "makes the reader want to click through. End on an implicit 'read more'."
        ),
    },
    "tldr": {
        "label": "TL;DR summary",
        "directive": (
            "Write a TL;DR: one framing sentence, then 3-5 tight bullet points capturing "
            "the key claims. No fluff."
        ),
    },
    "meta_description": {
        "label": "SEO meta description",
        "directive": (
            "Write a single SEO meta description: at most 155 characters, compelling, "
            "front-loads the value, no clickbait. Return only the description text."
        ),
    },
    "email": {
        "label": "Announcement email",
        "directive": (
            "Write a short announcement email: a subject line (prefix it 'Subject: '), "
            "then a 100-160 word body that frames why this post matters and links the "
            "reader to it. Warm, direct, one clear call to action."
        ),
    },
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _build_prompt(body: str, fmt: RepurposeFormat) -> str:
    directive = FORMATS[fmt]["directive"]
    return (
        f"{directive}\n\n"
        "Work only from the article below — don't invent facts it doesn't contain. "
        "Stay in the author's voice; banished words/phrases never appear. Return only "
        "the repurposed content, no preamble or explanation.\n\n"
        "ARTICLE:\n"
        f"{body.strip()}"
    )


async def repurpose(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    body: str,
    fmt: RepurposeFormat,
) -> str:
    """Return the assembled-markdown ``body`` rewritten for channel ``fmt``."""
    from blogforge.voice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=resolve_format(pack_root, draft.idea.format),
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _build_prompt(body, fmt)
    full_prompt = f"{system}\n\n---\n\n{user}"
    resp = await provider.complete(model=model, prompt=full_prompt)
    return resp.text.strip()
