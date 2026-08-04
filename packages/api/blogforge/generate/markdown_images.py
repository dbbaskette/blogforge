"""Remove embedded image payloads from imported Markdown."""

from __future__ import annotations

from dataclasses import dataclass

_FALLBACK_ALT = "embedded image"
_DATA_IMAGE_PREFIX = "data:image/"


@dataclass(frozen=True)
class EmbeddedImageCleanup:
    text: str
    removed_images: int
    removed_characters: int


def _placeholder(alt: str) -> str:
    return f"[Image omitted during import: {alt.strip() or _FALLBACK_ALT}]"


def _normalize_reference_label(label: str) -> str:
    return " ".join(label.split()).lower()


def _starts_with_case_insensitive(text: str, prefix: str, start: int) -> bool:
    return text[start : start + len(prefix)].lower() == prefix


def _find_closing_bracket(text: str, start: int, end: int) -> int | None:
    """Find an unescaped closing bracket without revisiting scanned characters."""
    position = start
    while position < end:
        if text[position] == "\\" and position + 1 < end:
            position += 2
        elif text[position] == "]":
            return position
        else:
            position += 1
    return None


def _readable_alt(alt: str) -> str:
    """Render escaped closing brackets as the readable Markdown alt text."""
    parts: list[str] = []
    position = 0
    while position < len(alt):
        if alt[position] == "\\" and position + 1 < len(alt) and alt[position + 1] == "]":
            parts.append("]")
            position += 2
        else:
            parts.append(alt[position])
            position += 1
    return "".join(parts)


def _fence_run(line: str) -> tuple[str, int] | None:
    position = 0
    while position < len(line) and position < 3 and line[position] == " ":
        position += 1
    if position >= len(line) or line[position] not in ("`", "~"):
        return None
    marker = line[position]
    run_end = position
    while run_end < len(line) and line[run_end] == marker:
        run_end += 1
    length = run_end - position
    return (marker, length) if length >= 3 else None


def _is_closing_fence(line: str, fence: tuple[str, int]) -> bool:
    run = _fence_run(line)
    if run is None or run[0] != fence[0] or run[1] < fence[1]:
        return False
    position = 0
    while position < len(line) and position < 3 and line[position] == " ":
        position += 1
    position += run[1]
    return all(character in " \t" for character in line[position:])


def _line_content(line: str) -> str:
    content = line.removesuffix("\n")
    return content.removesuffix("\r")


def _reference_definition_label(line: str) -> str | None:
    """Return the label only when this whole line defines a data image."""
    position = 0
    while position < len(line) and position < 3 and line[position] == " ":
        position += 1
    if position >= len(line) or line[position] != "[":
        return None

    label_start = position + 1
    label_end = _find_closing_bracket(line, label_start, len(line))
    if label_end is None or label_end == label_start:
        return None
    position = label_end + 1
    if position >= len(line) or line[position] != ":":
        return None
    position += 1
    while position < len(line) and line[position] in " \t":
        position += 1

    if position < len(line) and line[position] == "<":
        position += 1
    if not _starts_with_case_insensitive(line, _DATA_IMAGE_PREFIX, position):
        return None
    position += len(_DATA_IMAGE_PREFIX)
    payload_start = position
    while position < len(line) and not line[position].isspace() and line[position] != ">":
        position += 1
    if position == payload_start:
        return None
    if position < len(line) and line[position] == ">":
        position += 1
    if position < len(line) and line[position] not in " \t":
        return None
    return _readable_alt(line[label_start:label_end])


def _remove_reference_definitions(markdown: str) -> tuple[str, set[str], int, int]:
    parts: list[str] = []
    labels: set[str] = set()
    removed_images = 0
    removed_characters = 0
    fence: tuple[str, int] | None = None
    line_start = 0

    while line_start < len(markdown):
        newline = markdown.find("\n", line_start)
        line_end = len(markdown) if newline == -1 else newline + 1
        line = markdown[line_start:line_end]
        content = _line_content(line)

        if fence is not None:
            parts.append(line)
            if _is_closing_fence(content, fence):
                fence = None
        else:
            opening = _fence_run(content)
            if opening is not None:
                fence = opening
                parts.append(line)
            else:
                label = _reference_definition_label(content)
                if label is None:
                    parts.append(line)
                else:
                    labels.add(_normalize_reference_label(label))
                    removed_images += 1
                    removed_characters += len(content)
        line_start = line_end

    return "".join(parts), labels, removed_images, removed_characters


def _inline_data_image_end(text: str, open_paren: int, end: int) -> tuple[bool, int | None]:
    """Return (is_data_image, end position); ``None`` marks malformed data syntax."""
    position = open_paren + 1
    while position < end and text[position].isspace():
        position += 1
    if position < end and text[position] == "<":
        position += 1
    if not _starts_with_case_insensitive(text, _DATA_IMAGE_PREFIX, position):
        return False, None

    position += len(_DATA_IMAGE_PREFIX)
    payload_start = position
    while position < end and not text[position].isspace() and text[position] not in ")>":
        position += 1
    if position == payload_start:
        return False, None
    if position < end and text[position] == ">":
        position += 1
    if position < end and text[position] == ")":
        return True, position + 1

    while position < end and text[position].isspace():
        position += 1
    if position >= end:
        return True, None

    delimiter = text[position]
    if delimiter in ('"', "'"):
        position += 1
        while position < end:
            if text[position] == "\\" and position + 1 < end:
                position += 2
            elif text[position] == delimiter:
                position += 1
                break
            else:
                position += 1
        else:
            return True, None
    elif delimiter == "(":
        title_end = text.find(")", position + 1, end)
        if title_end == -1:
            return True, None
        position = title_end + 1
    else:
        return True, None

    while position < end and text[position].isspace():
        position += 1
    return (True, position + 1) if position < end and text[position] == ")" else (True, None)


def _html_image_end(text: str, start: int, end: int) -> int | None:
    position = start + 4
    quote: str | None = None
    while position < end:
        character = text[position]
        if quote is not None:
            if character == quote:
                quote = None
        elif character in ('"', "'"):
            quote = character
        elif character == ">":
            return position + 1
        position += 1
    return None


def _html_image_attributes(image: str) -> tuple[str | None, bool]:
    alt: str | None = None
    has_data_source = False
    position = 4
    tag_end = len(image) - 1

    while position < tag_end:
        while position < tag_end and (image[position].isspace() or image[position] == "/"):
            position += 1
        name_start = position
        while position < tag_end and not image[position].isspace() and image[position] not in "=/>":
            position += 1
        if position == name_start:
            position += 1
            continue
        name = image[name_start:position].lower()
        while position < tag_end and image[position].isspace():
            position += 1
        if position >= tag_end or image[position] != "=":
            continue
        position += 1
        while position < tag_end and image[position].isspace():
            position += 1

        if position < tag_end and image[position] in ('"', "'"):
            quote = image[position]
            position += 1
            value_start = position
            while position < tag_end and image[position] != quote:
                position += 1
            value = image[value_start:position]
            if position < tag_end:
                position += 1
        else:
            value_start = position
            while position < tag_end and not image[position].isspace() and image[position] != ">":
                position += 1
            value = image[value_start:position]

        if name == "alt" and alt is None:
            alt = value
        elif name == "src" and value.lower().startswith(_DATA_IMAGE_PREFIX):
            has_data_source = True

    return alt, has_data_source


def _replace_images_on_line(line: str, embedded_reference_labels: set[str]) -> tuple[str, int, int]:
    parts: list[str] = []
    removed_images = 0
    removed_characters = 0
    position = 0

    while position < len(line):
        if line.startswith("![", position):
            alt_start = position + 2
            alt_end = _find_closing_bracket(line, alt_start, len(line))
            if alt_end is None:
                parts.append(line[position:])
                break
            raw_alt = line[alt_start:alt_end]
            readable_alt = _readable_alt(raw_alt)
            after_alt = alt_end + 1

            if after_alt < len(line) and line[after_alt] == "(":
                is_data, image_end = _inline_data_image_end(line, after_alt, len(line))
                if is_data and image_end is None:
                    parts.append(line[position:])
                    break
                if is_data and image_end is not None:
                    parts.append(_placeholder(readable_alt))
                    removed_images += 1
                    removed_characters += image_end - position
                    position = image_end
                    continue
            elif after_alt < len(line) and line[after_alt] == "[":
                label_start = after_alt + 1
                label_end = _find_closing_bracket(line, label_start, len(line))
                if label_end is None:
                    parts.append(line[position:])
                    break
                label = line[label_start:label_end] or readable_alt
                image_end = label_end + 1
                if _normalize_reference_label(_readable_alt(label)) in embedded_reference_labels:
                    parts.append(_placeholder(readable_alt))
                else:
                    parts.append(line[position:image_end])
                position = image_end
                continue
            elif (
                readable_alt
                and _normalize_reference_label(readable_alt) in embedded_reference_labels
            ):
                parts.append(_placeholder(readable_alt))
                position = after_alt
                continue

            parts.append(line[position:after_alt])
            position = after_alt
            continue

        if (
            _starts_with_case_insensitive(line, "<img", position)
            and position + 4 < len(line)
            and (line[position + 4].isspace() or line[position + 4] in "/>")
        ):
            image_end = _html_image_end(line, position, len(line))
            if image_end is None:
                parts.append(line[position:])
                break
            image = line[position:image_end]
            alt, has_data_source = _html_image_attributes(image)
            if has_data_source:
                parts.append(_placeholder(alt or ""))
                removed_images += 1
                removed_characters += len(image)
            else:
                parts.append(image)
            position = image_end
            continue

        parts.append(line[position])
        position += 1

    return "".join(parts), removed_images, removed_characters


def _replace_images(markdown: str, labels: set[str]) -> tuple[str, int, int]:
    parts: list[str] = []
    removed_images = 0
    removed_characters = 0
    fence: tuple[str, int] | None = None
    line_start = 0

    while line_start < len(markdown):
        newline = markdown.find("\n", line_start)
        line_end = len(markdown) if newline == -1 else newline + 1
        line = markdown[line_start:line_end]
        content = _line_content(line)

        if fence is not None:
            parts.append(line)
            if _is_closing_fence(content, fence):
                fence = None
        else:
            opening = _fence_run(content)
            if opening is not None:
                fence = opening
                parts.append(line)
            else:
                replaced, line_images, line_characters = _replace_images_on_line(line, labels)
                parts.append(replaced)
                removed_images += line_images
                removed_characters += line_characters
        line_start = line_end

    return "".join(parts), removed_images, removed_characters


def strip_embedded_images(markdown: str) -> EmbeddedImageCleanup:
    """Replace Markdown and HTML ``data:image`` payloads with readable text."""
    text, labels, definition_images, definition_characters = _remove_reference_definitions(markdown)
    text, inline_images, inline_characters = _replace_images(text, labels)
    return EmbeddedImageCleanup(
        text=text,
        removed_images=definition_images + inline_images,
        removed_characters=definition_characters + inline_characters,
    )
