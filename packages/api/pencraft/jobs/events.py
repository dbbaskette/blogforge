"""SSE serialization helpers."""
from __future__ import annotations

import json
from typing import Any


def sse_format(event: dict[str, Any]) -> str:
    """Format one event as a Server-Sent Event: 'data: <json>\\n\\n'."""
    return f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
