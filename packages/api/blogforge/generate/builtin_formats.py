"""Built-in output formats — ready-made article *structures* the writer can pick
regardless of pack or voice source.

A pack can still define its own named formats (rendered from a template file by
`voice.compose`). These built-ins are orthogonal: the format shapes the article's
STRUCTURE while the voice profile/pack controls the TONE. Their directive is
appended to the generation prompt (outline + body) on top of the composed voice
prompt, so "write a product release IN my voice" works.
"""

from __future__ import annotations

# Order here is the dropdown order. `slug` is what the draft stores in
# `idea.format`; `name` is the label; `directive` is the structural add-on.
BUILTIN_FORMATS: list[dict[str, str]] = [
    {
        "slug": "product-release",
        "name": "Product release / launch",
        "description": "Announce a new release — what it is, what's new, why it matters.",
        "directive": (
            "Structure this as a PRODUCT RELEASE / LAUNCH post:\n"
            "- Open with what the product/feature IS and the single headline change this "
            "release delivers (name it explicitly in the first lines).\n"
            "- 'What's new' — the concrete changes/capabilities, most important first.\n"
            "- 'Why it matters' — the real problem each change solves, with specifics.\n"
            "- 'How to get it / get started' — upgrade or install steps and a first action.\n"
            "Lead with substance a reader can act on; announce by teaching, not hyping."
        ),
    },
    {
        "slug": "how-to",
        "name": "How-to / tutorial",
        "description": "Step-by-step guide to accomplish a task.",
        "directive": (
            "Structure this as a HOW-TO / TUTORIAL:\n"
            "- Open by stating exactly what the reader will be able to do by the end.\n"
            "- 'Prerequisites' — what they need before starting.\n"
            "- Numbered steps, each a single action with the expected result; include the "
            "commands/code/settings involved.\n"
            "- Close with how to verify it worked and one common pitfall to avoid.\n"
            "Keep steps self-contained and skimmable."
        ),
    },
    {
        "slug": "deep-dive",
        "name": "Deep dive / explainer",
        "description": "Thorough explanation of a concept or system.",
        "directive": (
            "Structure this as a DEEP DIVE / EXPLAINER:\n"
            "- Open with a one-line definition of the subject, then why it's worth "
            "understanding.\n"
            "- Build from the fundamentals up: how it works, the key moving parts, and the "
            "tradeoffs or failure modes.\n"
            "- Use concrete examples; when comparing options, prefer a table.\n"
            "- Close with when to use it (and when not to)."
        ),
    },
    {
        "slug": "comparison",
        "name": "Comparison (X vs Y)",
        "description": "Weigh options against each other on shared criteria.",
        "directive": (
            "Structure this as a COMPARISON (X vs Y):\n"
            "- Open by naming the options and the decision the reader is trying to make.\n"
            "- Define the criteria that actually matter for that decision.\n"
            "- Compare the options across those criteria — lead with a compact comparison "
            "TABLE, then discuss the nuances the table can't hold.\n"
            "- Close with a clear recommendation by use case (not a vague 'it depends')."
        ),
    },
    {
        "slug": "announcement",
        "name": "Announcement / update",
        "description": "A short, focused update on one change or news.",
        "directive": (
            "Structure this as a short ANNOUNCEMENT / UPDATE:\n"
            "- State the news in the first sentence — what changed, effective when.\n"
            "- One short section on what it means for the reader and any action needed.\n"
            "- Keep it tight; link out for detail rather than reproducing it.\n"
            "- Close with where to go next."
        ),
    },
    {
        "slug": "listicle",
        "name": "Listicle",
        "description": "A numbered list of items, each a self-contained point.",
        "directive": (
            "Structure this as a LISTICLE:\n"
            "- Open with a one-line framing of what the list delivers and who it's for.\n"
            "- A numbered list where each item is a self-contained point with a bold "
            "lead-in, then a couple of sentences of substance (an example or specific).\n"
            "- Order items by value, strongest first.\n"
            "- Close with a one-line takeaway."
        ),
    },
]

_BY_KEY: dict[str, dict[str, str]] = {}
for _f in BUILTIN_FORMATS:
    _BY_KEY[_f["slug"]] = _f
    _BY_KEY[_f["name"].lower()] = _f


def list_builtin_formats() -> list[dict[str, str]]:
    """The formats to show in the picker: {name, description}. `name` is the slug
    stored on the draft; `description` is the label shown (matches pack-format
    shape: the picker renders '<name> — <description>')."""
    return [
        {"name": f["slug"], "description": f"{f['name']} — {f['description']}"}
        for f in BUILTIN_FORMATS
    ]


def builtin_format_directive(requested: str | None) -> str | None:
    """The structural directive for a built-in format, matched by slug or label.
    None when `requested` isn't a built-in (a pack format, or nothing)."""
    if not requested:
        return None
    found = _BY_KEY.get(requested.strip().lower())
    return found["directive"] if found else None


def builtin_format_section_note(requested: str | None) -> str | None:
    """Format guidance for a SINGLE section. Unlike the whole-post directive,
    this frames the format as context so the section adopts the format's
    conventions (numbered steps, a comparison table, …) without trying to
    reproduce the entire article skeleton. None when not a built-in."""
    directive = builtin_format_directive(requested)
    if directive is None:
        return None
    return (
        "The overall post follows a specific format (below, FOR CONTEXT). Write "
        "only the current section — do not reproduce the whole structure — but "
        "apply this format's conventions where they fit this section:\n"
        f"{directive}"
    )
