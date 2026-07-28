"""Fact-check / citation grounding.

Extracts the checkable factual claims from a finished draft and judges each
against the reference materials the author attached: is it supported by a
source, unsupported (needs a citation), or contradicted by one? This closes
the loop on references — they're ingested for generation context but were
never surfaced as "does the draft actually match its sources."

Analytical, not voice-shaped, so it skips compose_prompt and calls the
provider directly with a structured JSON schema.
"""
# ruff: noqa: E501

from __future__ import annotations

import json

from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import (
    FACTUAL_RATIONALE,
    OUTPUT_RATIONALE,
    PromptRule,
    render_prompt_rules,
)

_CLAIMS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "status": {
                        "type": "string",
                        "enum": ["supported", "unsupported", "contradicted"],
                    },
                    "note": {"type": "string"},
                },
                "required": ["text", "status", "note"],
            },
        }
    },
    "required": ["claims"],
}


def _build_prompt(markdown: str, reference_context: str) -> str:
    if reference_context.strip():
        sources = (
            f"Reference materials the author attached are below:\n\n{reference_context.strip()}"
        )
        source_rules = render_prompt_rules(
            [
                PromptRule(
                    "Judge claims only against the attached sources.",
                    FACTUAL_RATIONALE,
                ),
                PromptRule(
                    "Mark a claim `supported` only when a reference clearly backs it and name that reference in `note`.",
                    "The writer needs a traceable basis for each favorable verdict.",
                ),
                PromptRule(
                    "Mark a claim `contradicted` when a reference conflicts with it and identify the conflict in `note`.",
                    "A contradiction needs evidence the writer can inspect and correct.",
                ),
                PromptRule(
                    "Mark a claim `unsupported` when no attached reference addresses it.",
                    "Unverified claims need a citation rather than an invented verdict.",
                ),
            ],
            bullet=True,
        )
    else:
        sources = "No reference materials are attached to this draft."
        source_rules = render_prompt_rules(
            [
                PromptRule(
                    "Mark every checkable factual claim `unsupported` and note that it needs a citation when no sources are attached.",
                    "Without evidence, the writer needs to add a citation before publishing.",
                ),
                PromptRule(
                    "Do not invent sources.",
                    FACTUAL_RATIONALE,
                ),
            ],
            bullet=True,
        )
    rules = render_prompt_rules(
        [
            PromptRule(
                "Extract only specific, checkable factual claims.",
                "Opinions and hedged arguments cannot be responsibly verified against sources.",
            ),
            PromptRule(
                "Skip opinions, hedged statements, and the author's own arguments.",
                "The fact-checking workflow is limited to claims with an external factual basis.",
            ),
            PromptRule(
                "Order findings with contradicted claims first, then unsupported, then supported.",
                "The writer should see the most urgent factual problems first.",
            ),
            PromptRule(
                "Return JSON matching the claims schema.",
                OUTPUT_RATIONALE,
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels into claim text or notes.",
                "Claim text and notes are parsed into writer-facing review fields, so prompt metadata would corrupt the factual review output.",
            ),
        ],
        bullet=True,
    )
    return (
        "You are a careful fact-checker. Extract the specific, checkable factual "
        "claims from the article below, such as statistics, dates, attributions, "
        "and definitive assertions about the world.\n\n"
        f"{rules}\n\n"
        f"For each claim, classify it:\n{source_rules}\n\n"
        'Claims schema: {"claims": [{"text": "...", "status": "...", "note": "..."}]}.\n\n'
        f"{sources}\n\n"
        "---\n\nARTICLE:\n"
        f"{markdown.strip()}"
    )


async def check_claims(
    markdown: str,
    reference_context: str,
    provider: LLMProvider,
    *,
    model: str,
) -> list[dict[str, str]]:
    """Return checkable claims with a support verdict against the references."""
    prompt = _build_prompt(markdown, reference_context)
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_CLAIMS_SCHEMA)
    try:
        data = json.loads(resp.text)
    except json.JSONDecodeError:
        return []
    claims = data.get("claims", []) if isinstance(data, dict) else []
    out: list[dict[str, str]] = []
    for c in claims:
        if not isinstance(c, dict):
            continue
        text = str(c.get("text", "")).strip()
        status = str(c.get("status", "")).strip()
        if text and status in ("supported", "unsupported", "contradicted"):
            out.append({"text": text, "status": status, "note": str(c.get("note", "")).strip()})
    return out
