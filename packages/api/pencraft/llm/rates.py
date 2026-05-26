"""Load the static rate card bundled with the package."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import TypedDict

import yaml


class RateEntry(TypedDict):
    label: str
    input_per_million_usd: float
    output_per_million_usd: float
    context_window: int
    supports_streaming: bool


@lru_cache(maxsize=1)
def load_rates() -> dict[str, dict[str, RateEntry]]:
    path = Path(__file__).parent / "rates.yaml"
    with path.open("r", encoding="utf-8") as f:
        data: dict[str, dict[str, RateEntry]] = yaml.safe_load(f)
        return data


def models_for(provider: str) -> dict[str, RateEntry]:
    return load_rates().get(provider, {})
