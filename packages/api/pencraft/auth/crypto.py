"""Symmetric secret cipher for at-rest secrets.

Wraps cryptography.fernet so we can rotate the underlying primitive
without touching every call site. The cipher derives its Fernet key
from any utf-8 string via SHA-256 + url-safe base64, so we can drive it
from `Settings.session_secret` (default) or a dedicated
`Settings.key_encryption_secret` later without forcing operators to
hand-roll a 32-byte base64 string.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet


def _derive_key(secret: str) -> bytes:
    """Turn any non-empty string into a Fernet-format key (32 url-safe base64 bytes)."""
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


class SecretCipher:
    """Encrypt / decrypt short strings (e.g. API keys) at rest.

    encrypt() returns a url-safe text token suitable for direct storage
    in a TEXT column. decrypt() raises cryptography.fernet.InvalidToken
    (or one of its subclasses) on tamper / wrong-secret.
    """

    def __init__(self, secret: str) -> None:
        if not secret:
            raise ValueError("SecretCipher needs a non-empty secret")
        self._fernet = Fernet(_derive_key(secret))

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
