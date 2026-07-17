from __future__ import annotations

import subprocess

import pytest


def _version(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/bash", "scripts/version.sh", *args],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize(
    ("baseline", "candidate"),
    [("0.7.0", "0.7.1"), ("0.7.9", "0.8.0"), ("0.99.99", "1.0.0")],
)
def test_compare_accepts_strict_increase(baseline: str, candidate: str) -> None:
    result = _version("compare", baseline, candidate)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("baseline", "candidate"),
    [
        ("0.7.0", "0.7.0"),
        ("0.7.1", "0.7.0"),
        ("0.7", "0.7.1"),
        ("0.7.0", "next"),
    ],
)
def test_compare_rejects_nonincrease_or_malformed(
    baseline: str, candidate: str
) -> None:
    result = _version("compare", baseline, candidate)
    assert result.returncode != 0
