"""Signed session cookies.

The cookie payload is just the user id. We don't pack an issued_at or
expiry into the cookie itself — the cookie's Max-Age (set at the
Set-Cookie layer) is enough, and tying validity to a DB lookup means we
can disable users instantly without rotating the secret.
"""
from uuid import UUID

from itsdangerous import BadSignature, URLSafeSerializer

COOKIE_NAME = "pencraft_session"
COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60  # 14 days


class SessionSigner:
    """Wraps itsdangerous to sign/unsign a user UUID."""

    def __init__(self, secret: str) -> None:
        self._serializer = URLSafeSerializer(secret, salt="pencraft-session")

    def sign(self, user_id: UUID) -> str:
        return self._serializer.dumps(str(user_id))

    def unsign(self, cookie: str) -> UUID | None:
        if not cookie:
            return None
        try:
            value = self._serializer.loads(cookie)
        except BadSignature:
            return None
        try:
            return UUID(str(value))
        except (ValueError, TypeError):
            return None
