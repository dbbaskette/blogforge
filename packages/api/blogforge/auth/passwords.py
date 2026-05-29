"""Argon2id password hashing. Defaults are the argon2-cffi v23 defaults."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    """Return an argon2id hash of `plain`."""
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """True if `plain` verifies against `hashed`. False on any mismatch."""
    try:
        _hasher.verify(hashed, plain)
        return True
    except (VerifyMismatchError, InvalidHashError):
        return False
