"""Fernet-based secret cipher round-trips and rejects bad inputs."""
import pytest

from pencraft.auth.crypto import SecretCipher


def test_round_trip():
    c = SecretCipher("some-secret")
    token = c.encrypt("hello-world")
    assert c.decrypt(token) == "hello-world"


def test_different_secrets_dont_share_tokens():
    a = SecretCipher("secret-a")
    b = SecretCipher("secret-b")
    token = a.encrypt("payload")
    with pytest.raises(Exception):
        b.decrypt(token)


def test_tampered_token_rejected():
    c = SecretCipher("secret")
    token = c.encrypt("payload")
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(Exception):
        c.decrypt(tampered)


def test_empty_plaintext_round_trips():
    c = SecretCipher("secret")
    token = c.encrypt("")
    assert c.decrypt(token) == ""
