import { describe, expect, it } from "vitest";

import { stripEmbeddedImages } from "../../src/lib/markdownImages";

describe("stripEmbeddedImages", () => {
  it("replaces an inline data image with its alt-text placeholder and records its source size", () => {
    const markdown = "Before ![Quarterly chart](data:image/png;base64,QUJDRA==) after.";

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "Before [Image omitted during import: Quarterly chart] after.",
      removedImages: 1,
      removedCharacters: "![Quarterly chart](data:image/png;base64,QUJDRA==)".length,
    });
  });

  it("replaces an inline data image that spans multiple lines", () => {
    const image = "![two\nlines](data:image/png;base64,QQ==)";
    const markdown = `Before ${image} after.`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "Before [Image omitted during import: two\nlines] after.",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("replaces every image use of a data-image reference without recounting its definition", () => {
    const definition = '[Hero Image]: data:image/jpeg;base64,QUJDRA== "launch art"';
    const markdown = `![First caption][hero image]\n![Second caption][ HERO   IMAGE ]\n${definition}\nClosing prose.`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "[Image omitted during import: First caption]\n[Image omitted during import: Second caption]\nClosing prose.",
      removedImages: 1,
      removedCharacters: definition.length,
    });
  });

  it("does not consume prose after a data-image reference without metadata", () => {
    const definition = "[Diagram]: data:image/png;base64,QUJDRA==";
    const markdown = `![Architecture][diagram]\n${definition}\nKeep this paragraph.`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "[Image omitted during import: Architecture]\nKeep this paragraph.",
      removedImages: 1,
      removedCharacters: definition.length,
    });
  });

  it("replaces a shortcut image reference backed by an embedded data-image definition", () => {
    const definition = "[Logo]: data:image/png;base64,QUJDRA==";
    const markdown = `![Logo]\n${definition}`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "[Image omitted during import: Logo]\n",
      removedImages: 1,
      removedCharacters: definition.length,
    });
  });

  it("replaces a quoted HTML data image and preserves surrounding attributes", () => {
    const image =
      '<img class="hero" alt="Product shot" src="data:image/webp;base64,QUJDRA==" loading="lazy">';
    const markdown = `Intro ${image} outro`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "Intro [Image omitted during import: Product shot] outro",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("replaces an HTML data image whose attributes and closing bracket span lines", () => {
    const image = '<img\n  alt="diagram"\n  src="data:image/png;base64,QQ=="\n>';
    const markdown = `Before ${image} after.`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "Before [Image omitted during import: diagram] after.",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("strips unquoted HTML data sources without treating data-alt as alt text", () => {
    const withAlt = "<img alt=Logo src=data:image/png;base64,QQ==>";
    const dataAltOnly = '<img data-alt="not an alt attribute" src=data:image/png;base64,Qg==>';
    const markdown = `${withAlt} ${dataAltOnly}`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "[Image omitted during import: Logo] [Image omitted during import: embedded image]",
      removedImages: 2,
      removedCharacters: withAlt.length + dataAltOnly.length,
    });
  });

  it("uses the embedded-image fallback for empty markdown and HTML alt text", () => {
    const markdown =
      "![](data:image/gif;base64,QQ==) <img alt='' src='data:image/gif;base64,Qg=='>";

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "[Image omitted during import: embedded image] [Image omitted during import: embedded image]",
      removedImages: 2,
      removedCharacters:
        "![](data:image/gif;base64,QQ==)".length +
        "<img alt='' src='data:image/gif;base64,Qg=='>".length,
    });
  });

  it("replaces an inline data image with an escaped closing bracket in its alt text", () => {
    const image = String.raw`![a\]b](data:image/png;base64,QQ==)`;

    expect(stripEmbeddedImages(image)).toEqual({
      text: "[Image omitted during import: a]b]",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("replaces an HTML data image when a quoted attribute contains a greater-than sign", () => {
    const image = '<img alt="a > b" src="data:image/png;base64,QQ==">';

    expect(stripEmbeddedImages(image)).toEqual({
      text: "[Image omitted during import: a > b]",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("preserves embedded image syntax inside backtick and tilde fences", () => {
    const markdown = [
      "````markdown",
      "![inside](data:image/png;base64,QQ==)",
      "![inside across",
      "lines](data:image/png;base64,Qg==)",
      '<img alt="inside > html" src="data:image/png;base64,Qg==">',
      "<img",
      '  alt="inside across lines"',
      '  src="data:image/png;base64,Qw=="',
      ">",
      "```",
      "still fenced",
      "``````",
      "~~~",
      "![also inside](data:image/png;base64,Qw==)",
      "~~~~",
      "![outside](data:image/png;base64,RA==)",
    ].join("\n");

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: markdown.replace(
        "![outside](data:image/png;base64,RA==)",
        "[Image omitted during import: outside]",
      ),
      removedImages: 1,
      removedCharacters: "![outside](data:image/png;base64,RA==)".length,
    });
  });

  it("preserves large unterminated image syntax unchanged", () => {
    const markdown = `${"![unterminated ".repeat(4_000)}retained prose`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: markdown,
      removedImages: 0,
      removedCharacters: 0,
    });
  });

  it("continues after malformed Markdown and removes a later HTML data image", () => {
    const image = '<img alt="later" src="data:image/png;base64,QQ==">';
    const markdown = `broken ![\n${image}`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "broken ![\n[Image omitted during import: later]",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("continues after malformed HTML and removes a later Markdown data image", () => {
    const image = "![later](data:image/png;base64,QQ==)";
    const markdown = `<img\n${image}`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: "<img\n[Image omitted during import: later]",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("continues after malformed data destinations and reference labels", () => {
    const html = '<img alt="html" src="data:image/png;base64,QQ==">';
    const inline = `![broken](data:image/png;base64,AAAA\nsome prose\n${html}`;
    const markdownImage = "![markdown](data:image/png;base64,Qg==)";
    const reference = `![broken][missing\nintervening prose\n${markdownImage}`;

    expect(stripEmbeddedImages(`${inline}\n${reference}`)).toEqual({
      text:
        "![broken](data:image/png;base64,AAAA\nsome prose\n" +
        "[Image omitted during import: html]\n" +
        "![broken][missing\nintervening prose\n" +
        "[Image omitted during import: markdown]",
      removedImages: 2,
      removedCharacters: html.length + markdownImage.length,
    });
  });

  it("continues after same-line garbage in a malformed data destination", () => {
    const image = "![later](data:image/png;base64,QQ==)";
    const markdown = `![broken](data:image/png;base64,AAAA garbage\n${image}`;

    expect(stripEmbeddedImages(markdown)).toEqual({
      text:
        "![broken](data:image/png;base64,AAAA garbage\n" + "[Image omitted during import: later]",
      removedImages: 1,
      removedCharacters: image.length,
    });
  });

  it("leaves HTTP, relative, attachment, and non-image data destinations unchanged", () => {
    const markdown = [
      "![HTTP](https://example.com/image.png)",
      "![Relative](./images/chart.png)",
      "![Attachment](attachment:hero.png)",
      "[Download](data:application/pdf;base64,QUJDRA==)",
      '<img alt="Remote" src="https://example.com/image.png">',
    ].join("\n");

    expect(stripEmbeddedImages(markdown)).toEqual({
      text: markdown,
      removedImages: 0,
      removedCharacters: 0,
    });
  });
});
