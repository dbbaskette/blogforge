"""API datetimes must serialize timezone-aware (UTC).

SQLite returns naive datetimes; serialized without a timezone suffix, browsers
parse them as LOCAL time — which stuck the voice "new since distill" badge for
hours (naive added_at parsed as local vs aware distilled_at parsed as UTC) and
skews every relative-time display. UtcDatetime re-attaches UTC on validation.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from blogforge.drafts.models import Reference
from blogforge.voice.models import VoiceProfile, VoiceSample

NAIVE_ADDED = datetime(2026, 7, 2, 14, 18, 57)  # what SQLite hands back
AWARE_DISTILLED = datetime(2026, 7, 2, 14, 29, 19, tzinfo=UTC)


def _sample(added: datetime) -> VoiceSample:
    return VoiceSample(id="s1", kind="text", s3_key="k", added_at=added)


def test_naive_datetimes_serialize_with_utc_suffix() -> None:
    dumped = json.loads(_sample(NAIVE_ADDED).model_dump_json())
    assert dumped["added_at"].endswith(("Z", "+00:00"))


def test_aware_datetimes_pass_through_unchanged() -> None:
    p = VoiceProfile(id="p1", user_id="u1", distilled_at=AWARE_DISTILLED)
    assert p.distilled_at == AWARE_DISTILLED


def test_mixed_naive_aware_comparison_is_consistent() -> None:
    # The exact badge bug: sample added (naive, from SQLite) BEFORE the distill
    # (aware, in-memory). After normalization the comparison must be direct.
    s = _sample(NAIVE_ADDED)
    assert s.added_at < AWARE_DISTILLED  # would raise TypeError if still naive


def test_reference_added_at_normalized_too() -> None:
    r = Reference(id="r1", kind="url", name="n", added_at=NAIVE_ADDED)
    assert r.added_at.tzinfo is not None
    assert json.loads(r.model_dump_json())["added_at"].endswith(("Z", "+00:00"))


def test_none_distilled_at_still_allowed() -> None:
    p = VoiceProfile(id="p1", user_id="u1")
    assert p.distilled_at is None
