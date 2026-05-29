"""Signed session cookies.

The cookie payload is the user id plus a `session_version`. Validity is
tied to a DB lookup (so we can disable users instantly without rotating
the secret), and the version lets us invalidate every existing cookie at
once — "sign out all sessions" and password changes bump the user's
session_version, so older cookies no longer match.
"""
from uuid import UUID

from itsdangerous import BadSignature, URLSafeSerializer

COOKIE_NAME = "pencraft_session"
COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60  # 14 days


class SessionSigner:
    """Wraps itsdangerous to sign/unsign (user UUID, session_version)."""

    def __init__(self, secret: str) -> None:
        self._serializer = URLSafeSerializer(secret, salt="pencraft-session")

    def sign(self, user_id: UUID, session_version: int = 0) -> str:
        return self._serializer.dumps({"u": str(user_id), "v": int(session_version)})

    def unsign(self, cookie: str) -> tuple[UUID, int] | None:
        """Return (user_id, session_version) or None. Tolerates the legacy
        payload (a bare user-id string) as version 0 for cookies issued
        before this field existed."""
        if not cookie:
            return None
        try:
            value = self._serializer.loads(cookie)
        except BadSignature:
            return None
        if isinstance(value, dict):
            raw_uid = value.get("u")
            raw_ver = value.get("v", 0)
        else:
            raw_uid = value  # legacy bare-string payload
            raw_ver = 0
        try:
            return UUID(str(raw_uid)), int(raw_ver)
        except (ValueError, TypeError):
            return None
