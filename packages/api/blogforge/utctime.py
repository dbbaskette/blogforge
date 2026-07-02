"""UTC-normalizing datetime type for API response models.

SQLite (the no-Docker local DB) returns naive datetimes; pydantic serializes
those without a timezone suffix, and browsers parse suffix-less ISO strings as
LOCAL time — skewing every timestamp comparison and relative-time display by
the user's UTC offset (e.g. the voice "new since distill" badge sticking for
4 hours in EDT). All app datetimes are UTC by construction (`datetime.now(UTC)`
at write time; SQLite just drops the tzinfo), so it is always correct to
re-attach UTC to naive values at validation. Aware values pass through.
"""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator


def _ensure_utc(v: datetime) -> datetime:
    return v.replace(tzinfo=UTC) if v.tzinfo is None else v


UtcDatetime = Annotated[datetime, AfterValidator(_ensure_utc)]
