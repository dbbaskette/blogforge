"""Fact-check / citation grounding.

Extracts the checkable factual claims from a finished draft and judges each
against the reference materials the author attached: is it supported by a
source, unsupported (needs a citation), or contradicted by one? This closes
the loop on references — they're ingested for generation context but were
never surfaced as "does the draft actually match its sources."

Analytical, not voice-shaped, so it skips compose_prompt and calls the
provider directly with a structured JSON schema.
"""
from __future__ import annotations

import json

from blogforge.llm.base import LLMProvider

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
            "Reference materials the author attached are below. Judge each claim "
            "ONLY against these sources:\n\n"
            f"{reference_context.strip()}"
        )
        rules = (
            "- supported: a reference clearly backs the claim (name it in `note`).\n"
            "- contradicted: a reference conflicts with the claim (quote/point to it).\n"
            "- unsupported: no attached reference speaks to it — it needs a citation."
        )
    else:
        sources = "No reference materials are attached to this draft."
        rules = (
            "With no sources attached, mark every checkable factual claim "
            "`unsupported` and note that it needs a citation. Do not invent sources."
        )
    return (
        "You are a careful fact-checker. Extract the specific, checkable factual "
        "claims from the article below — statistics, dates, attributions, "
        "definitive assertions about the world. Skip opinions, hedged statements, "
        "and the author's own arguments.\n\n"
        f"For each claim, classify it:\n{rules}\n\n"
        'Return JSON: {"claims": [{"text": "...", "status": "...", "note": "..."}]}. '
        "Order by severity: contradicted first, then unsupported, then supported.\n\n"
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
