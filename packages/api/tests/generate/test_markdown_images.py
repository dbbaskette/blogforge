from blogforge.generate.markdown_images import EmbeddedImageCleanup, strip_embedded_images


def test_replaces_inline_data_image_with_alt_placeholder_and_source_size() -> None:
    markdown = "Before ![Quarterly chart](data:image/png;base64,QUJDRA==) after."

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text="Before [Image omitted during import: Quarterly chart] after.",
        removed_images=1,
        removed_characters=len("![Quarterly chart](data:image/png;base64,QUJDRA==)"),
    )


def test_replaces_reference_uses_without_recounting_data_image_definition() -> None:
    definition = '[Hero Image]: data:image/jpeg;base64,QUJDRA== "launch art"'
    markdown = f"![First caption][hero image]\n![Second caption][ HERO   IMAGE ]\n{definition}\n"

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text=(
            "[Image omitted during import: First caption]\n"
            "[Image omitted during import: Second caption]\n"
        ),
        removed_images=1,
        removed_characters=len(definition),
    )


def test_does_not_consume_prose_after_data_image_reference_without_metadata() -> None:
    definition = "[Diagram]: data:image/png;base64,QUJDRA=="
    markdown = f"![Architecture][diagram]\n{definition}\nKeep this paragraph."

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text="[Image omitted during import: Architecture]\nKeep this paragraph.",
        removed_images=1,
        removed_characters=len(definition),
    )


def test_replaces_shortcut_image_reference_backed_by_data_image_definition() -> None:
    definition = "[Logo]: data:image/png;base64,QUJDRA=="
    markdown = f"![Logo]\n{definition}"

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text="[Image omitted during import: Logo]\n",
        removed_images=1,
        removed_characters=len(definition),
    )


def test_replaces_quoted_html_data_image_with_alt_placeholder() -> None:
    image = (
        '<img class="hero" alt="Product shot" src="data:image/webp;base64,QUJDRA==" loading="lazy">'
    )
    markdown = f"Intro {image} outro"

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text="Intro [Image omitted during import: Product shot] outro",
        removed_images=1,
        removed_characters=len(image),
    )


def test_strips_unquoted_html_data_source_without_using_data_alt_as_alt_text() -> None:
    with_alt = "<img alt=Logo src=data:image/png;base64,QQ==>"
    data_alt_only = '<img data-alt="not an alt attribute" src=data:image/png;base64,Qg==>'
    markdown = f"{with_alt} {data_alt_only}"

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text="[Image omitted during import: Logo] [Image omitted during import: embedded image]",
        removed_images=2,
        removed_characters=len(with_alt) + len(data_alt_only),
    )


def test_uses_embedded_image_fallback_for_empty_alt_text() -> None:
    markdown = "![](data:image/gif;base64,QQ==) <img alt='' src='data:image/gif;base64,Qg=='>"

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text=(
            "[Image omitted during import: embedded image] "
            "[Image omitted during import: embedded image]"
        ),
        removed_images=2,
        removed_characters=len("![](data:image/gif;base64,QQ==)")
        + len("<img alt='' src='data:image/gif;base64,Qg=='>"),
    )


def test_replaces_inline_data_image_with_escaped_closing_bracket_in_alt() -> None:
    image = r"![a\]b](data:image/png;base64,QQ==)"

    assert strip_embedded_images(image) == EmbeddedImageCleanup(
        text="[Image omitted during import: a]b]",
        removed_images=1,
        removed_characters=len(image),
    )


def test_replaces_html_data_image_when_quoted_attribute_contains_greater_than() -> None:
    image = '<img alt="a > b" src="data:image/png;base64,QQ==">'

    assert strip_embedded_images(image) == EmbeddedImageCleanup(
        text="[Image omitted during import: a > b]",
        removed_images=1,
        removed_characters=len(image),
    )


def test_preserves_embedded_image_syntax_inside_backtick_and_tilde_fences() -> None:
    markdown = "\n".join(
        [
            "````markdown",
            "![inside](data:image/png;base64,QQ==)",
            '<img alt="inside > html" src="data:image/png;base64,Qg==">',
            "```",
            "still fenced",
            "``````",
            "~~~",
            "![also inside](data:image/png;base64,Qw==)",
            "~~~~",
            "![outside](data:image/png;base64,RA==)",
        ]
    )
    expected = markdown.replace(
        "![outside](data:image/png;base64,RA==)",
        "[Image omitted during import: outside]",
    )

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text=expected,
        removed_images=1,
        removed_characters=len("![outside](data:image/png;base64,RA==)"),
    )


def test_preserves_large_unterminated_image_syntax_unchanged() -> None:
    markdown = "![unterminated " * 4_000 + "retained prose"

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text=markdown,
        removed_images=0,
        removed_characters=0,
    )


def test_preserves_non_embedded_image_and_data_links() -> None:
    markdown = "\n".join(
        [
            "![HTTP](https://example.com/image.png)",
            "![Relative](./images/chart.png)",
            "![Attachment](attachment:hero.png)",
            "[Download](data:application/pdf;base64,QUJDRA==)",
            '<img alt="Remote" src="https://example.com/image.png">',
        ]
    )

    assert strip_embedded_images(markdown) == EmbeddedImageCleanup(
        text=markdown,
        removed_images=0,
        removed_characters=0,
    )
