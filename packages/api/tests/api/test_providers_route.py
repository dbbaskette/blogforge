"""GET /api/providers — availability and model listing.

NOTE: The admin-global / myvoice-config-based tests have been removed as part of
the per-user keys migration (Task 4/5). The route is being updated in Task 5 to
use per-user key lookup; the unknown-provider 404 test is preserved as it remains
correct.
"""
from __future__ import annotations

import pytest


def test_list_models_unknown_provider_404(authed_client) -> None:
    client, _ = authed_client
    r = client.get("/api/providers/nope/models")
    assert r.status_code == 404
