"""Signed OAuth `state` parameter.

Carries the initiating user's id through the LinkedIn redirect round-trip
and doubles as CSRF protection: only a state we signed (and that hasn't
expired) is accepted at the callback. Uses itsdangerous with a dedicated
salt so it can't be confused with session cookies signed by the same secret.
"""
from __future__ import annotations

from uuid import UUID

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

_SALT = "pencraft-linkedin-oauth-state"
DEFAULT_MAX_AGE = 600  # 10 minutes


def _serializer(secret: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret, salt=_SALT)


def sign_state(user_id: UUID, *, secret: str) -> str:
    return _serializer(secret).dumps(str(user_id))


def verify_state(
    token: str, *, secret: str, max_age: int = DEFAULT_MAX_AGE
) -> UUID | None:
    if not token:
        return None
    try:
        value = _serializer(secret).loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None
