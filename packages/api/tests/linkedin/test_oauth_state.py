"""OAuth state token signs the user id, with CSRF + short TTL guarantees."""
from uuid import uuid4

from pencraft.linkedin.state import sign_state, verify_state


def test_round_trip():
    uid = uuid4()
    token = sign_state(uid, secret="s")
    assert verify_state(token, secret="s") == uid


def test_tampered_returns_none():
    uid = uuid4()
    token = sign_state(uid, secret="s")
    # Mutate a char in the payload segment (before the first ".") to a
    # definitely-different value, so the HMAC verification fails. (Flipping
    # an arbitrary char can be a no-op if it lands on base64 unused bits.)
    dot = token.index(".")
    pos = max(0, dot - 2)
    swap = "A" if token[pos] != "A" else "B"
    tampered = token[:pos] + swap + token[pos + 1 :]
    assert verify_state(tampered, secret="s") is None


def test_wrong_secret_returns_none():
    token = sign_state(uuid4(), secret="secret-a")
    assert verify_state(token, secret="secret-b") is None


def test_expired_returns_none():
    uid = uuid4()
    token = sign_state(uid, secret="s")
    # max_age -1 forces the expiry path (token age 0 > -1), independent of
    # wall-clock timing within the same second.
    assert verify_state(token, secret="s", max_age=-1) is None


def test_garbage_returns_none():
    assert verify_state("not-a-token", secret="s") is None
    assert verify_state("", secret="s") is None
