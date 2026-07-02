"""GET /api/drafts/{id}/download."""

from __future__ import annotations


async def test_download_returns_markdown(authed_client) -> None:
    client, _ = authed_client
    created = client.post(
        "/api/drafts",
        json={"topic": "Hello", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    assert "text/markdown" in r.headers["content-type"]
    assert "# Hello" in r.text


async def test_download_content_disposition_header(authed_client) -> None:
    client, _ = authed_client
    created = client.post(
        "/api/drafts",
        json={"topic": "My Post", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    r = client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    assert ".md" in r.headers["content-disposition"]


async def test_download_unknown_404(authed_client) -> None:
    client, _ = authed_client
    r = client.get("/api/drafts/nope/download")
    assert r.status_code == 404


async def test_download_title_with_typographic_punctuation(authed_client) -> None:
    """Curly quotes / em dashes / typographic apostrophes are not latin-1, and
    HTTP headers must be — an unsanitized filename raised UnicodeEncodeError
    (a 500) the moment a title used smart punctuation."""
    client, _ = authed_client
    created = client.post(
        "/api/drafts",
        json={
            "topic": "“Faster is Still Safer” — the Three R’s",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "m",
        },
    ).json()
    r = client.get(f"/api/drafts/{created['id']}/download")
    assert r.status_code == 200
    cd = r.headers["content-disposition"]
    assert "attachment" in cd and ".md" in cd
    # The header filename must be plain ASCII with no stray quotes.
    filename = cd.split('filename="', 1)[1].rstrip('"')
    assert filename.isascii()
    assert '"' not in filename


def _seed_written(client) -> str:
    created = client.post(
        "/api/drafts",
        json={"topic": "My Essay", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    created["title"] = "My Essay"
    created["outline"] = {
        "opening_hook": "A compelling hook.",
        "sections": [{"id": "s1", "title": "First", "brief": ""}],
        "estimated_words": 0,
    }
    created["sections"] = [
        {
            "id": "s1",
            "title": "First",
            "brief": "",
            "content_md": "Some **bold** prose and a [link](https://x.com).",
            "status": "ready",
            "word_count": 7,
        },
    ]
    created["stage"] = "sections"
    created["tags"] = ["essay"]
    client.put(f"/api/drafts/{created['id']}", json=created)
    return created["id"]


async def test_download_html(authed_client) -> None:
    client, _ = authed_client
    did = _seed_written(client)
    r = client.get(f"/api/drafts/{did}/download?format=html")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert ".html" in r.headers["content-disposition"]
    assert "<!doctype html>" in r.text.lower()
    assert "<title>My Essay</title>" in r.text
    # Markdown inline emphasis is rendered to real HTML.
    assert "<strong>bold</strong>" in r.text
    assert "<h2>First</h2>" in r.text


async def test_download_docx(authed_client) -> None:
    client, _ = authed_client
    did = _seed_written(client)
    r = client.get(f"/api/drafts/{did}/download?format=docx")
    assert r.status_code == 200
    assert "wordprocessingml" in r.headers["content-type"]
    assert ".docx" in r.headers["content-disposition"]
    # .docx is a zip — verify the magic bytes and non-trivial size.
    assert r.content[:2] == b"PK"
    assert len(r.content) > 1000


async def test_download_markdown_with_frontmatter(authed_client) -> None:
    client, _ = authed_client
    did = _seed_written(client)
    r = client.get(f"/api/drafts/{did}/download?format=md&frontmatter=true")
    assert r.status_code == 200
    assert r.text.startswith("---\n")
    assert "title: My Essay" in r.text
    assert "pack: dan" in r.text
    assert "essay" in r.text  # tag in the frontmatter list
    # Body still present after the frontmatter block.
    assert "## First" in r.text


async def test_download_html_embeds_article_schema_and_updated_byline(authed_client) -> None:
    client, _ = authed_client
    did = _seed_written(client)
    r = client.get(f"/api/drafts/{did}/download?format=html")
    assert '"@type": "Article"' in r.text
    assert '"dateModified"' in r.text
    assert "application/ld+json" in r.text
    assert 'class="byline">Updated ' in r.text


async def test_download_html_emits_faqpage_schema_when_faq_present(authed_client) -> None:
    client, _ = authed_client
    created = client.post(
        "/api/drafts",
        json={"topic": "T", "pack_slug": "dan", "provider": "anthropic", "model": "m"},
    ).json()
    created["title"] = "T"
    created["sections"] = [
        {
            "id": "s1",
            "title": "Body",
            "brief": "",
            "content_md": "Prose here.\n\n### FAQ\n\n**What is it?**\n\nA tool that helps.",
            "status": "ready",
            "word_count": 3,
        },
    ]
    created["stage"] = "sections"
    client.put(f"/api/drafts/{created['id']}", json=created)
    r = client.get(f"/api/drafts/{created['id']}/download?format=html")
    assert '"@type": "FAQPage"' in r.text
    assert '"What is it?"' in r.text


async def test_download_markdown_frontmatter_has_lastmod(authed_client) -> None:
    client, _ = authed_client
    did = _seed_written(client)
    r = client.get(f"/api/drafts/{did}/download?format=md&frontmatter=true")
    assert "lastmod:" in r.text


async def test_download_unsupported_format_422(authed_client) -> None:
    client, _ = authed_client
    did = _seed_written(client)
    r = client.get(f"/api/drafts/{did}/download?format=pdf")
    assert r.status_code == 422
    assert r.json()["detail"]["error"]["code"] == "unsupported_format"
