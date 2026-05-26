"""ANALYZE stage for outline: render prompt, call LLM with json_schema, validate."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Template

from pencraft.drafts.models import IdeaInput, OutlineProposal
from pencraft.llm.base import LLMProvider

_PROMPT_PATH = Path(__file__).parent / "prompts" / "outline.j2"


def _render_outline_prompt(idea: IdeaInput) -> str:
    template = Template(_PROMPT_PATH.read_text(encoding="utf-8"))
    return template.render(idea=idea)


def _auto_pick_samples(manifest: dict[str, Any], n: int = 2) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


async def propose_outline(
    idea: IdeaInput,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
) -> OutlineProposal:
    """Single LLM call. Returns a validated OutlineProposal."""
    from myvoice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=2)
    system = compose_prompt(
        pack_root,
        format=idea.format,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _render_outline_prompt(idea)
    schema = OutlineProposal.model_json_schema()
    full_prompt = f"{system}\n\n---\n\n{user}"
    response = await provider.complete(model=model, prompt=full_prompt, json_schema=schema)
    return OutlineProposal.model_validate_json(response.text)
