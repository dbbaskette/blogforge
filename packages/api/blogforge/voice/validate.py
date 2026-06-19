"""Validate a style pack directory against SPEC.md v1.0."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml
from pydantic import ValidationError as PydanticValidationError

from blogforge.voice.packs.manifest import Manifest


@dataclass(frozen=True)
class ValidationError:
    """One spec violation. `path` is a hint like 'pack.slug' or 'samples[0].file'."""

    message: str
    path: str = ""


@dataclass
class ValidationResult:
    valid: bool
    manifest: Manifest | None = None
    errors: list[ValidationError] = field(default_factory=list)


def validate_pack(pack_root: Path) -> ValidationResult:
    """Validate the pack rooted at `pack_root`.

    Returns a ValidationResult with `valid=True` only if every spec rule
    holds. Otherwise returns `valid=False` with the full list of errors;
    we report all errors we can, not just the first.
    """
    errors: list[ValidationError] = []
    manifest: Manifest | None = None

    manifest_path = pack_root / "stylepack.yaml"
    if not manifest_path.is_file():
        errors.append(ValidationError(
            f"missing required file: stylepack.yaml in {pack_root}",
            "stylepack.yaml",
        ))
        return ValidationResult(valid=False, errors=errors)

    try:
        raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        errors.append(ValidationError(f"stylepack.yaml: invalid YAML — {exc}"))
        return ValidationResult(valid=False, errors=errors)

    try:
        manifest = Manifest.model_validate(raw)
    except PydanticValidationError as exc:
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"])
            errors.append(ValidationError(f"{loc}: {err['msg']}", loc))
        return ValidationResult(valid=False, errors=errors)

    # slug must match directory name
    if manifest.pack.slug != pack_root.name:
        errors.append(ValidationError(
            f"pack.slug '{manifest.pack.slug}' does not match dir name '{pack_root.name}'",
            "pack.slug",
        ))

    # style-guide.md must exist and be non-empty
    sg = pack_root / "style-guide.md"
    if not sg.is_file():
        errors.append(ValidationError("missing required file: style-guide.md", "style-guide.md"))
    elif sg.stat().st_size == 0:
        errors.append(ValidationError("style-guide.md is empty", "style-guide.md"))

    # formats, samples, bios: declared files must exist and be non-empty
    for i, fmt in enumerate(manifest.formats):
        p = pack_root / fmt.file
        if not p.is_file() or p.stat().st_size == 0:
            errors.append(ValidationError(
                f"formats[{i}].file not found or empty: {fmt.file}", f"formats[{i}].file"
            ))

    for i, sample in enumerate(manifest.samples):
        p = pack_root / sample.file
        if not p.is_file() or p.stat().st_size == 0:
            errors.append(ValidationError(
                f"samples[{i}].file not found or empty: {sample.file}", f"samples[{i}].file"
            ))
            continue
        # sample must contain at least one blockquote line
        body = p.read_text(encoding="utf-8")
        if not any(line.startswith("> ") for line in body.splitlines()):
            errors.append(ValidationError(
                f"samples[{i}] ({sample.file}) contains no blockquote (lines starting with '> ')",
                f"samples[{i}].file",
            ))

    for i, bio in enumerate(manifest.bios):
        p = pack_root / bio.file
        if not p.is_file() or p.stat().st_size == 0:
            errors.append(ValidationError(
                f"bios[{i}].file not found or empty: {bio.file}", f"bios[{i}].file"
            ))
            continue
        if bio.max_chars is not None:
            body = _extract_bio_body(p.read_text(encoding="utf-8"))
            body_len = len(body)
            if body_len > bio.max_chars:
                msg = (
                    f"bios[{i}] ({bio.name}) body is {body_len} chars, "
                    f"exceeds max_chars={bio.max_chars}"
                )
                errors.append(ValidationError(msg, f"bios[{i}].max_chars"))

    return ValidationResult(valid=(not errors), manifest=manifest, errors=errors)


def _extract_bio_body(text: str) -> str:
    """Extract the bio body from a bios/*.md file.

    The file contains: an H1 heading, blockquote(s) holding the bio body,
    and optional italic-only meta lines (e.g. '*155 characters.*'). The
    body is what the composer eventually emits — only the blockquote
    content with the '> ' prefix stripped, joined by single newlines,
    paragraphs separated by single blank lines.
    """
    lines: list[str] = []
    for raw in text.splitlines():
        if raw.startswith("> "):
            lines.append(raw[2:])
        elif raw.strip() == ">":
            lines.append("")
    return "\n".join(lines).strip()
