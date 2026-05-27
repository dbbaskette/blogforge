"""Cookie signer round-trips data and rejects tampered payloads."""
from uuid import uuid4

from pencraft.auth.sessions import SessionSigner


def test_round_trip():
    s = SessionSigner("secret-a")
    uid = uuid4()
    cookie = s.sign(uid)
    assert s.unsign(cookie) == uid


def test_tampered_cookie_rejected():
    s = SessionSigner("secret-a")
    uid = uuid4()
    cookie = s.sign(uid)
    # Flip a char in the payload (before the `.` separator) so we mutate a
    # bit that definitely affects HMAC verification. (Flipping the LAST char
    # of a URL-safe base64-no-padding signature can be a no-op because the
    # tail char carries unused bits — bit-equivalent variants decode the same.)
    dot = cookie.index(".")
    pos = dot // 2  # somewhere in the payload
    swap = "a" if cookie[pos] != "a" else "b"
    tampered = cookie[:pos] + swap + cookie[pos + 1:]
    assert s.unsign(tampered) is None


def test_different_secrets_dont_share_cookies():
    a = SessionSigner("secret-a")
    b = SessionSigner("secret-b")
    cookie = a.sign(uuid4())
    assert b.unsign(cookie) is None


def test_garbage_returns_none():
    s = SessionSigner("secret-a")
    assert s.unsign("garbage") is None
    assert s.unsign("") is None
