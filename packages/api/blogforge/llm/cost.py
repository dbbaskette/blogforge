"""Token → USD cost calculation. Pure function, table-driven."""
from __future__ import annotations

from blogforge.llm.rates import models_for


def usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    """Approximate cost in USD. Returns 0 for unknown provider/model."""
    entry = models_for(provider).get(model)
    if entry is None:
        return 0.0
    in_cost = (input_tokens / 1_000_000) * entry["input_per_million_usd"]
    out_cost = (output_tokens / 1_000_000) * entry["output_per_million_usd"]
    return round(in_cost + out_cost, 6)
