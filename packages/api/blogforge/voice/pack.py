"""Voice pack materialization — builds a myvoice-compatible style pack on disk.

Converts a ``VoiceProfile`` (BlogForge model) into a myvoice SPEC v1.0 pack
directory so callers can pass the path directly to ``myvoice.compose_prompt``.

Cache key: ``{cache_root}/{profile.id}/{profile.version}/``
The pack dir name is set to the pack slug (``profile-{profile.id}``) so it
satisfies myvoice's slug-must-match-directory check when validate_pack is run,
but compose_prompt itself does not check this invariant — only compose reads
the manifest without cross-checking the directory name.
"""
from __future__ import annotations

import io
import os
import tempfile
import zipfile
from pathlib import Path

import yaml

from blogforge.voice.models import VoiceProfile

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _slug(profile: VoiceProfile) -> str:
    """A filesystem-safe slug for this profile's pack directory."""
    return f"profile-{profile.id}"


def _cache_root() -> Path:
    """Return the cache root directory (created if absent)."""
    env = os.environ.get("BLOGFORGE_VOICE_PACK_CACHE")
    if env:
        root = Path(env)
    else:
        root = Path(tempfile.gettempdir()) / "blogforge-voice-pack-cache"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _pack_dir(profile: VoiceProfile) -> Path:
    """Absolute path to the versioned pack directory (not yet created)."""
    return _cache_root() / profile.id / str(profile.version) / _slug(profile)


def _build_manifest(profile: VoiceProfile, exemplar_ids: list[str]) -> dict:
    """Build a myvoice SPEC v1.0 manifest dict from a VoiceProfile."""
    rules = profile.rules

    samples_list = [
        {
            "id": sid,
            "file": f"samples/{sid}.md",
            "description": _sample_name(profile, sid),
        }
        for sid in exemplar_ids
    ]

    return {
        "spec_version": "1.0",
        "pack": {
            "slug": _slug(profile),
            "name": profile.name,
            "version": str(profile.version),
            "author": profile.user_id,
        },
        "persona": {
            "identity": profile.persona_identity or "Author",
            "one_line": profile.persona_one_line or "Writes with clarity and authenticity.",
            "tone": profile.persona_tone or None,
        },
        "banished": {
            "words": list(rules.banished_words),
            "phrases": list(rules.banished_phrases),
        },
        "rules": {
            "no_em_dashes": rules.no_em_dashes,
            "no_ascii_double_hyphen_between_letters": rules.no_ascii_double_hyphen,
            "no_sentence_starters": [],
        },
        "pop_culture": {
            "allowed": [],
            "banned": [],
        },
        "formats": [],
        "samples": samples_list,
        "bios": [],
    }


def _sample_name(profile: VoiceProfile, sample_id: str) -> str:
    """Look up the VoiceSample name for a given sample id."""
    for s in profile.samples:
        if s.id == sample_id:
            return s.name or sample_id
    return sample_id


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def materialize(profile: VoiceProfile, sample_texts: dict[str, str]) -> Path:
    """Write a complete myvoice pack to the cache and return the pack directory.

    Args:
        profile: The ``VoiceProfile`` to serialize.
        sample_texts: Mapping of ``{sample_id: text}`` for all exemplar samples.
            Fetching from S3 is the caller's responsibility; this function is
            intentionally pure/testable.

    Returns:
        The ``Path`` to the materialized pack directory.  If the directory
        already exists (same ``profile.id`` + ``profile.version``) the cached
        pack is returned immediately without rewriting.
    """
    pack_dir = _pack_dir(profile)

    # Cache hit: return early if the pack already exists.
    if (pack_dir / "stylepack.yaml").is_file():
        return pack_dir

    pack_dir.mkdir(parents=True, exist_ok=True)
    samples_dir = pack_dir / "samples"
    samples_dir.mkdir(exist_ok=True)

    # Determine which exemplar sample ids to include in the manifest.
    exemplar_ids = [
        s.id
        for s in profile.samples
        if s.exemplar and s.id in sample_texts
    ]

    # --- stylepack.yaml ---
    manifest = _build_manifest(profile, exemplar_ids)
    (pack_dir / "stylepack.yaml").write_text(
        yaml.safe_dump(manifest, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )

    # --- style-guide.md ---
    style_md = profile.distilled_style_md or "## Style Guide\n\nContent pending distillation."
    (pack_dir / "style-guide.md").write_text(style_md, encoding="utf-8")

    # --- samples/{id}.md ---
    for sid in exemplar_ids:
        text = sample_texts[sid]
        # myvoice _render_samples expects blockquote lines (">" prefix).
        # Wrap the entire text so the composer can extract it correctly.
        blockquoted = "\n".join(
            f"> {line}" if line.strip() else ">"
            for line in text.splitlines()
        ) if text.splitlines() else f"> {text}"
        (samples_dir / f"{sid}.md").write_text(blockquoted, encoding="utf-8")

    return pack_dir


def export_zip(pack_dir: Path) -> bytes:
    """Zip the contents of a materialized pack directory and return the bytes.

    The zip archive contains ``stylepack.yaml``, ``style-guide.md``, and all
    files under ``samples/``.

    Args:
        pack_dir: Path returned by :func:`materialize`.

    Returns:
        Raw ZIP bytes (starts with ``PK``).
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(pack_dir.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(pack_dir))
    return buf.getvalue()
