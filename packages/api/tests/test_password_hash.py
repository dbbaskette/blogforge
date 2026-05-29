"""argon2 hash + verify."""
from blogforge.auth.passwords import hash_password, verify_password


def test_round_trip():
    h = hash_password("hunter2")
    assert verify_password("hunter2", h) is True
    assert verify_password("wrong", h) is False


def test_two_hashes_of_same_password_differ():
    h1 = hash_password("same")
    h2 = hash_password("same")
    assert h1 != h2
    assert verify_password("same", h1)
    assert verify_password("same", h2)


def test_handles_empty_string():
    h = hash_password("")
    assert verify_password("", h) is True
    assert verify_password("x", h) is False
