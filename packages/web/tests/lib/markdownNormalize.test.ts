import { describe, expect, it } from "vitest";

import { needsNormalizing, normalizeMarkdown } from "../../src/lib/markdownNormalize";

const NBSP = String.fromCharCode(0xa0);

describe("normalizeMarkdown", () => {
  it("converts word-processor bullet glyphs to markdown dashes", () => {
    expect(normalizeMarkdown("• one\n• two")).toBe("- one\n- two");
    expect(normalizeMarkdown("  ◦ nested")).toBe("  - nested");
    expect(normalizeMarkdown("▪ a\n‣ b")).toBe("- a\n- b");
  });

  it("converts '1)' numbering to markdown '1.' at line start only", () => {
    expect(normalizeMarkdown("1) first\n2) second")).toBe("1. first\n2. second");
    expect(normalizeMarkdown("see step 2) here")).toBe("see step 2) here");
  });

  it("normalizes CRLF and non-breaking spaces", () => {
    expect(normalizeMarkdown("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeMarkdown(`a${NBSP}b`)).toBe("a b");
  });

  it("leaves already-clean markdown untouched", () => {
    const md = "# Title\n\n## Section\n\n- a\n- b\n\n1. one\n2. two";
    expect(normalizeMarkdown(md)).toBe(md);
    expect(needsNormalizing(md)).toBe(false);
  });

  it("does not touch a bullet glyph mid-sentence", () => {
    expect(normalizeMarkdown("rated 5 • stars")).toBe("rated 5 • stars");
  });

  it("needsNormalizing flags dirty content", () => {
    expect(needsNormalizing("• bullet")).toBe(true);
    expect(needsNormalizing("clean text")).toBe(false);
  });
});
