import subprocess
from pathlib import Path


def test_no_myvoice_imports_in_source() -> None:
    root = Path(__file__).resolve().parents[2] / "blogforge"
    hits = subprocess.run(
        ["grep", "-rnE", r"^[[:space:]]*(from|import) myvoice", str(root)],
        capture_output=True, text=True,
    ).stdout.strip()
    assert hits == "", f"myvoice import(s) crept back:\n{hits}"
