"""Parse a LinkedIn 'Get a copy of your data' archive into persona + writing samples."""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from dataclasses import dataclass, field

import trafilatura

PERSONA_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "identity": {"type": "string"},
        "one_line": {"type": "string"},
        "tone": {"type": "string"},
    },
    "required": ["identity", "one_line", "tone"],
}


class LinkedInImportError(Exception):
    """Raised when an uploaded archive has no usable Profile/Articles."""


@dataclass
class Article:
    title: str
    text: str


@dataclass
class LinkedInProfile:
    headline: str = ""
    summary: str = ""
    articles: list[Article] = field(default_factory=list)


def parse_linkedin_archive(data: bytes) -> LinkedInProfile:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise LinkedInImportError("That file isn't a valid .zip archive.") from exc

    names = zf.namelist()
    files = [n for n in names if not n.endswith("/")]
    if len(files) == 1 and files[0].lower().endswith(".zip"):  # download double-zip
        return parse_linkedin_archive(zf.read(files[0]))

    prof = LinkedInProfile()
    pc = next((n for n in names if n.lower().endswith("profile.csv")), None)
    if pc:
        rows = list(csv.DictReader(io.StringIO(zf.read(pc).decode("utf-8", "replace"))))
        if rows:
            prof.headline = (rows[0].get("Headline") or "").strip()
            prof.summary = (rows[0].get("Summary") or "").strip()

    for n in names:
        if "articles/" in n.lower() and n.lower().endswith((".html", ".htm")):
            raw = zf.read(n).decode("utf-8", "replace")
            text = (trafilatura.extract(raw, favor_recall=True) or "").strip()
            text = re.sub(r"^(?:Created on|Published on)[^\n]*\n?", "", text).strip()
            if len(text) < 40:
                continue
            m = re.search(r"<title[^>]*>([^<]+)</title>", raw, re.IGNORECASE)
            title = m.group(1).strip() if m else n.rsplit("/", 1)[-1].rsplit(".", 1)[0].replace("-", " ")
            prof.articles.append(Article(title=title, text=text))

    if not prof.headline and not prof.summary and not prof.articles:
        raise LinkedInImportError("No Profile.csv or Articles found in the archive.")
    return prof


def build_persona_prompt(headline: str, summary: str) -> str:
    return (
        "From this LinkedIn profile, write a concise writing-voice persona.\n\n"
        f"Headline: {headline}\n\nAbout:\n{summary}\n\n"
        "Return JSON with three one-line fields: `identity` (who they are "
        "professionally), `one_line` (a short tagline in their own voice), and "
        "`tone` (a few words describing how they write)."
    )


def parse_persona(text: str) -> tuple[str, str, str]:
    data = json.loads(text)
    return (
        str(data.get("identity", "")).strip(),
        str(data.get("one_line", "")).strip(),
        str(data.get("tone", "")).strip(),
    )
