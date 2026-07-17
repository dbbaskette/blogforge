"""Export rendering — JSON-LD carries the Article description (GEO-3)."""

from __future__ import annotations

from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, Section
from blogforge.export.render import json_ld, to_markdown


def _draft() -> Draft:
    idea = IdeaInput(topic="My Post", pack_slug="", provider="tanzu", model="m")
    return Draft(
        title="My Post",
        idea=idea,
        outline=OutlineProposal(
            opening_hook="BlogForge is a workshop for long-form writing.  More context here."
        ),
        sections=[Section(id="s1", title="Body", content_md="text")],
        stage="sections",
    )


def test_json_ld_includes_description_from_opening() -> None:
    out = json_ld(_draft())
    assert '"description": "BlogForge is a workshop for long-form writing.' in out


def test_json_ld_description_capped_and_whitespace_collapsed() -> None:
    idea = IdeaInput(topic="T", pack_slug="", provider="tanzu", model="m")
    d = Draft(
        title="T",
        idea=idea,
        outline=OutlineProposal(opening_hook="word " * 100),
        sections=[Section(id="s", title="B", content_md="x")],
        stage="sections",
    )
    out = json_ld(d)
    # 160-char cap, no runaway whitespace.
    import json
    import re

    m = re.search(r'"description": "([^"]*)"', out)
    assert m and len(m.group(1)) <= 160
    json.loads(out.split("</script>")[0].split(">", 1)[1])  # Article block is valid JSON


def test_publish_frontmatter_uses_portable_hero_reference() -> None:
    draft = _draft()
    draft.hero_image_key = "drafts/internal/hero/generated.png"

    rendered = to_markdown(
        draft,
        frontmatter=True,
        hero_reference="my-post-hero.png",
    )

    assert "image: my-post-hero.png" in rendered
    assert "drafts/internal" not in rendered


def test_plain_publish_markdown_leads_with_hero_reference() -> None:
    rendered = to_markdown(
        _draft(),
        hero_reference="my-post-hero.png",
        include_hero_in_body=True,
    )

    assert rendered.startswith("![My Post](my-post-hero.png)\n\n")
