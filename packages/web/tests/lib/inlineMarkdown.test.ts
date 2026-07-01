import { describe, expect, it } from "vitest";

import { inlineMarkdownToHtml } from "../../src/lib/inlineMarkdown";

describe("inlineMarkdownToHtml", () => {
  it("renders bold/italic/code, not literal markers", () => {
    expect(inlineMarkdownToHtml("**ROTATE: identity**")).toBe("<strong>ROTATE: identity</strong>");
    expect(inlineMarkdownToHtml("*Faster* and `code`")).toBe(
      "<em>Faster</em> and <code>code</code>",
    );
    expect(inlineMarkdownToHtml("__bold__")).toBe("<strong>bold</strong>");
  });

  it("escapes HTML so a title can't inject markup", () => {
    const out = inlineMarkdownToHtml("<script>alert(1)</script> **x**");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    // Only our own emphasis tags survive.
    expect(out).toContain("<strong>x</strong>");
  });

  it("leaves snake_case and plain text alone", () => {
    expect(inlineMarkdownToHtml("The Three R's")).toBe("The Three R's");
    expect(inlineMarkdownToHtml("get_user_id flag")).toBe("get_user_id flag");
  });
});
