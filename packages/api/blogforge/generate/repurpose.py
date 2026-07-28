"""Repurpose a finished draft into a different channel — in the author's voice.

One blog → an X thread, a LinkedIn post, a newsletter blurb, a TL;DR, an SEO
meta description, or an announcement email. Operates on the assembled markdown
of the whole post (not a fragment) and returns the repurposed text
synchronously via provider.complete(); these outputs are short.

Voice setup mirrors section generation (same compose_prompt path) so the
repurposed copy reads like the same author wrote it for the new channel.
"""
# ruff: noqa: E501

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.generate.formats import resolve_format
from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import PromptRule, render_prompt_rules

RepurposeFormat = Literal[
    "x_thread", "linkedin", "linkedin_article", "newsletter", "tldr", "meta_description", "email"
]

# label is for the UI; directive is the channel-specific instruction.
FORMATS: dict[str, dict[str, str]] = {
    "x_thread": {
        "label": "X / Twitter thread",
        "directive": "Turn the post into an X (Twitter) thread.",
    },
    "linkedin": {
        "label": "LinkedIn post (feed)",
        "directive": "Turn the post into a LinkedIn feed post.",
    },
    "linkedin_article": {
        "label": "LinkedIn article (Pulse)",
        "directive": "Turn the post into a long-form LinkedIn (Pulse) article.",
    },
    "newsletter": {
        "label": "Newsletter blurb",
        "directive": "Write a newsletter intro for the post.",
    },
    "tldr": {
        "label": "TL;DR summary",
        "directive": "Write a TL;DR for the post.",
    },
    "meta_description": {
        "label": "SEO meta description",
        "directive": "Write an SEO meta description for the post.",
    },
    "email": {
        "label": "Announcement email",
        "directive": "Write an announcement email for the post.",
    },
}

_FORMAT_RULES: dict[RepurposeFormat, tuple[PromptRule, ...]] = {
    "x_thread": (
        PromptRule(
            "Open with a scroll-stopping hook tweet.",
            "The first tweet determines whether readers enter the thread.",
        ),
        PromptRule(
            "Follow with four to eight numbered tweets that carry the argument.",
            "A complete thread needs enough space to develop the article's point without becoming a wall of posts.",
        ),
        PromptRule(
            "Make each tweet stand alone.",
            "Readers encounter individual tweets out of context.",
        ),
        PromptRule(
            "Keep each tweet under 280 characters.",
            "The platform enforces its character limit.",
        ),
        PromptRule(
            "Number tweets like 1/, 2/.", "Clear numbering preserves the thread's reading order."
        ),
        PromptRule(
            "Use hashtags only when they are genuinely useful.",
            "Irrelevant tags make the author's voice sound promotional and distract from the argument.",
        ),
    ),
    "linkedin": (
        PromptRule(
            "Keep the feed post between 50 and 299 words.",
            "LinkedIn feed readers need a concise post that is not padded for length.",
        ),
        PromptRule(
            "Do not pad the feed post to look longer.",
            "Short LinkedIn posts can still be useful and cited, while padding wastes the reader's attention.",
        ),
        PromptRule(
            "Open with a strong first line.",
            "LinkedIn shows only the opening before the reader chooses 'see more'.",
        ),
        PromptRule(
            "Use short, punchy paragraphs with line breaks.",
            "Feed copy needs to remain scannable on a narrow timeline.",
        ),
        PromptRule(
            "Teach one concrete thing the reader learns instead of only announcing the post.",
            "Useful instruction earns attention and makes the post worth saving or sharing.",
        ),
        PromptRule(
            "Name the product or brand explicitly at least once.",
            "An explicit name travels with any citation or excerpt of the post.",
        ),
        PromptRule(
            "End with a soft prompt for discussion.",
            "A low-pressure close invites conversation without turning the post into an advertisement.",
        ),
        PromptRule(
            "Avoid buzzword soup.", "Vague promotional language weakens clarity and reader trust."
        ),
    ),
    "linkedin_article": (
        PromptRule(
            "Keep the Pulse article between 800 and 1,200 words.",
            "Pulse readers expect a substantial article while the surface still rewards a focused length.",
        ),
        PromptRule(
            "Use a clear title and short teaching sections with subheadings.",
            "Readable structure helps LinkedIn readers scan a long-form article.",
        ),
        PromptRule(
            "Give every section at least one concrete takeaway.",
            "Each section should leave the reader with something usable.",
        ),
        PromptRule(
            "Lead with actionable substance rather than an announcement.",
            "Readers open a Pulse article to learn, not to read promotional framing.",
        ),
        PromptRule(
            "Name the product or brand explicitly.",
            "Clear attribution keeps the subject identifiable when the article is cited or shared.",
        ),
        PromptRule(
            "Keep the article original and first-hand.",
            "First-hand detail makes the article more credible than a generic repost.",
        ),
        PromptRule(
            "Return the article body as Markdown.",
            "The consuming editor preserves article structure from Markdown.",
        ),
    ),
    "newsletter": (
        PromptRule(
            "Keep the newsletter intro between 90 and 150 words.",
            "An email teaser must be brief enough to lead into the linked article.",
        ),
        PromptRule(
            "Tease the post and make the reader want to click through.",
            "The newsletter's purpose is to carry readers into the full article.",
        ),
        PromptRule(
            "End with an implicit 'read more'.",
            "A subtle closing directs attention to the article without a hard sell.",
        ),
    ),
    "tldr": (
        PromptRule(
            "Use one framing sentence followed by three to five tight bullet points.",
            "A TL;DR needs a quick orientation and a scan-friendly summary of the key claims.",
        ),
        PromptRule(
            "Do not add fluff.", "Readers choose a TL;DR for the article's essential information."
        ),
    ),
    "meta_description": (
        PromptRule(
            "Write one SEO meta description of at most 155 characters.",
            "Search surfaces truncate longer descriptions.",
        ),
        PromptRule(
            "Make it compelling and front-load the value.",
            "Search readers decide quickly whether the result answers their need.",
        ),
        PromptRule(
            "Do not use clickbait.",
            "Misleading search copy damages trust and creates a poor click-through experience.",
        ),
        PromptRule(
            "Return only the description text.",
            "The metadata field cannot include commentary or labels.",
        ),
    ),
    "email": (
        PromptRule(
            "Start with a subject line prefixed `Subject: `.",
            "The email composer needs a recognizable subject line to split from the body.",
        ),
        PromptRule(
            "Keep the body between 100 and 160 words.",
            "An announcement email should be concise enough to retain attention.",
        ),
        PromptRule(
            "Explain why the post matters.",
            "Recipients need a reason to care before they decide to read more.",
        ),
        PromptRule(
            "Link the reader to the post.",
            "Recipients need a path to the full article.",
        ),
        PromptRule(
            "Use a warm, direct tone.",
            "A personal tone makes an announcement email feel written for its recipient.",
        ),
        PromptRule(
            "Use one clear call to action.",
            "A focused email makes the next step easy for readers to act on.",
        ),
    ),
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _build_prompt(body: str, fmt: RepurposeFormat) -> str:
    directive = FORMATS[fmt]["directive"]
    rules = render_prompt_rules(
        [
            *_FORMAT_RULES[fmt],
            PromptRule(
                "Use only facts present in the source article.",
                "Repurposed content must not introduce unsupported claims under the author's name.",
            ),
            PromptRule(
                "Follow the selected channel's length and formatting limits.",
                "The consuming surface truncates or misrenders content outside those limits.",
            ),
            PromptRule(
                "Use the author's voice.",
                "The repurposed copy should read like it came from the same author.",
            ),
            PromptRule(
                "Do not use banished words or phrases.",
                "Those terms conflict with the author's established voice and explicit preferences.",
            ),
            PromptRule(
                "Return only the repurposed content without a preamble or explanation.",
                "The editor places this response directly into the selected publishing surface.",
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "the repurposed content.",
                "Those labels are prompt metadata rather than article prose.",
            ),
        ]
    )
    return f"{directive}\n\n{rules}\n\nARTICLE:\n{body.strip()}"


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
