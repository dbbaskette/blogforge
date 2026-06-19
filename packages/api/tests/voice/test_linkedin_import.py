import io, zipfile
import pytest
from blogforge.voice.linkedin_import import (
    parse_linkedin_archive, LinkedInImportError, build_persona_prompt, parse_persona,
)


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_parses_profile_and_article() -> None:
    csv_text = "Headline,Summary\r\n\"Sr. Director @ X\",\"A leader in technical marketing.\"\r\n"
    html = "<html><head><title>My Article</title></head><body><p>" + ("Real writing about platforms. " * 20) + "</p></body></html>"
    prof = parse_linkedin_archive(_zip({"Profile.csv": csv_text, "Articles/Articles/a.html": html}))
    assert prof.headline == "Sr. Director @ X"
    assert "technical marketing" in prof.summary
    assert len(prof.articles) == 1
    assert prof.articles[0].title == "My Article"
    assert "platforms" in prof.articles[0].text


def test_empty_archive_raises() -> None:
    with pytest.raises(LinkedInImportError):
        parse_linkedin_archive(_zip({"random.txt": "nothing useful"}))


def test_persona_prompt_and_parse() -> None:
    p = build_persona_prompt("Head of X", "I build things.")
    assert "Head of X" in p and "I build things" in p
    assert parse_persona('{"identity":"a","one_line":"b","tone":"c"}') == ("a", "b", "c")
