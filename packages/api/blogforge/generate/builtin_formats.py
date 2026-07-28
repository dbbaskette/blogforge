"""Built-in output formats — ready-made article *structures* the writer can pick.

The format shapes the article's structure while a voice profile or pack controls
its tone. Each directive is appended to outline and body generation prompts.
"""

from __future__ import annotations

from blogforge.prompt_rules import PromptRule, render_prompt_rules


def _format_directive(name: str, rules: list[PromptRule]) -> str:
    """Render a structural format task with rationale-backed constraints."""
    return (
        f"Format task: Structure this as a {name} post.\n\n"
        + render_prompt_rules(rules, bullet=True)
    )


# Order here is the dropdown order. `slug` is what the draft stores in
# `idea.format`; `name` is the label; `directive` is the structural add-on.
BUILTIN_FORMATS: list[dict[str, str]] = [
    {
        "slug": "product-release",
        "name": "Product release / launch",
        "description": "Announce a new release — what it is, what's new, why it matters.",
        "directive": _format_directive(
            "PRODUCT RELEASE / LAUNCH",
            [
                PromptRule(
                    "Open with what the product or feature is and name the single headline "
                    "change in the first lines.",
                    "Readers need immediate context before they can judge the release.",
                ),
                PromptRule(
                    "Explain the concrete changes or capabilities, most important first.",
                    "Priority order helps readers find the change most relevant to them.",
                ),
                PromptRule(
                    "Connect each change to the real problem it solves with specifics.",
                    "A release announcement earns attention by showing practical value, not hype.",
                ),
                PromptRule(
                    "Include upgrade or install steps and a first action to get started.",
                    "Readers need a clear path from announcement to using the release.",
                ),
                PromptRule(
                    "Lead with substance a reader can act on; announce by teaching, not hyping.",
                    "Useful explanation makes the announcement credible and actionable.",
                ),
            ],
        ),
    },
    {
        "slug": "how-to",
        "name": "How-to / tutorial",
        "description": "Step-by-step guide to accomplish a task.",
        "directive": _format_directive(
            "HOW-TO / TUTORIAL",
            [
                PromptRule(
                    "Open by stating exactly what the reader will be able to do by the end.",
                    "A concrete outcome lets readers decide whether the tutorial fits their goal.",
                ),
                PromptRule(
                    "State the prerequisites before the first step.",
                    "Readers need to know what to prepare before following the procedure.",
                ),
                PromptRule(
                    "Use numbered steps where each step is one action with its expected result.",
                    "Tutorial readers need to execute and verify one operation at a time.",
                ),
                PromptRule(
                    "Include the commands, code, or settings needed for each relevant step.",
                    "Concrete implementation details make the procedure reproducible.",
                ),
                PromptRule(
                    "Close with verification guidance and one common pitfall.",
                    "Readers need to confirm success and recover from the most likely failure.",
                ),
                PromptRule(
                    "Keep steps self-contained and skimmable.",
                    "Readers often return to a specific step while working through the task.",
                ),
            ],
        ),
    },
    {
        "slug": "deep-dive",
        "name": "Deep dive / explainer",
        "description": "Thorough explanation of a concept or system.",
        "directive": _format_directive(
            "DEEP DIVE / EXPLAINER",
            [
                PromptRule(
                    "Open with a one-line definition of the subject and why it is worth "
                    "understanding.",
                    "Readers need a shared frame before the detailed explanation begins.",
                ),
                PromptRule(
                    "Build from fundamentals through how it works and its key moving parts.",
                    "A bottom-up explanation keeps technical detail understandable.",
                ),
                PromptRule(
                    "Cover relevant tradeoffs or failure modes.",
                    "An explainer is incomplete if it describes only the happy path.",
                ),
                PromptRule(
                    "Use concrete examples and a table when comparing options.",
                    "Examples ground abstractions, while tables make shared criteria easy to scan.",
                ),
                PromptRule(
                    "Close with when to use the subject and when not to.",
                    "Readers need a decision boundary, not only a description.",
                ),
            ],
        ),
    },
    {
        "slug": "comparison",
        "name": "Comparison (X vs Y)",
        "description": "Weigh options against each other on shared criteria.",
        "directive": _format_directive(
            "COMPARISON (X vs Y)",
            [
                PromptRule(
                    "Open by naming the options and the decision the reader is trying to make.",
                    "A comparison must be anchored to a real choice.",
                ),
                PromptRule(
                    "Define the criteria that actually matter for that decision.",
                    "Shared criteria prevent an arbitrary feature-by-feature list.",
                ),
                PromptRule(
                    "Lead with a compact comparison table across those criteria.",
                    "A table lets readers scan the important differences quickly.",
                ),
                PromptRule(
                    "Discuss the nuances that the table cannot hold.",
                    "Context explains where a simple comparison would be misleading.",
                ),
                PromptRule(
                    "Close with a clear recommendation by use case.",
                    "Readers need a decision they can apply instead of a vague 'it depends.'",
                ),
            ],
        ),
    },
    {
        "slug": "announcement",
        "name": "Announcement / update",
        "description": "A short, focused update on one change or news.",
        "directive": _format_directive(
            "short ANNOUNCEMENT / UPDATE",
            [
                PromptRule(
                    "State the news in the first sentence, including what changed and when "
                    "it is effective.",
                    "Readers of an update need the essential fact immediately.",
                ),
                PromptRule(
                    "Use one short section to explain what the change means and any action needed.",
                    "A focused update should answer the reader's practical question without "
                    "sprawling.",
                ),
                PromptRule(
                    "Keep the update tight and link out for detail rather than reproducing it.",
                    "The announcement should surface the change, not replace its full "
                    "documentation.",
                ),
                PromptRule(
                    "Close with where the reader should go next.",
                    "A next step turns news into an actionable update.",
                ),
            ],
        ),
    },
    {
        "slug": "listicle",
        "name": "Listicle",
        "description": "A numbered list of items, each a self-contained point.",
        "directive": _format_directive(
            "LISTICLE",
            [
                PromptRule(
                    "Open with one line that frames what the list delivers and who it is for.",
                    "Readers need to know the list's promise before deciding to continue.",
                ),
                PromptRule(
                    "Use a numbered list with a bold lead-in for each self-contained point.",
                    "Consistent visual structure makes individual items easy to scan and revisit.",
                ),
                PromptRule(
                    "Give every item a couple of sentences of substance, including an example "
                    "or specific.",
                    "Specific support keeps the list from becoming a collection of empty claims.",
                ),
                PromptRule(
                    "Order items by value, strongest first.",
                    "The opening items must earn the reader's attention.",
                ),
                PromptRule(
                    "Close with a one-line takeaway.",
                    "A concise ending ties the independent items back to one useful conclusion.",
                ),
            ],
        ),
    },
]

_BY_KEY: dict[str, dict[str, str]] = {}
for _f in BUILTIN_FORMATS:
    _BY_KEY[_f["slug"]] = _f
    _BY_KEY[_f["name"].lower()] = _f


def list_builtin_formats() -> list[dict[str, str]]:
    """Return the formats shown in the picker."""
    return [
        {"name": f["slug"], "description": f"{f['name']} — {f['description']}"}
        for f in BUILTIN_FORMATS
    ]


def builtin_format_directive(requested: str | None) -> str | None:
    """Return a structural directive, matched by built-in slug or label."""
    if not requested:
        return None
    found = _BY_KEY.get(requested.strip().lower())
    return found["directive"] if found else None


def builtin_format_section_note(requested: str | None) -> str | None:
    """Return format guidance scoped to one independently stored section."""
    directive = builtin_format_directive(requested)
    if directive is None:
        return None
    section_rule = render_prompt_rules([
        PromptRule(
            "Write only the current section; do not reproduce the whole structure.",
            "BlogForge stores and regenerates sections independently, so a section response "
            "must not recreate the whole article.",
        ),
        PromptRule(
            "Apply the overall format's conventions only where they fit this section.",
            "The format should guide local prose without forcing every section into the full "
            "article skeleton.",
        ),
    ])
    return f"Overall post format (context):\n{directive}\n\n{section_rule}"
