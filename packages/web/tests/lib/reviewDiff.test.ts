import { describe, expect, it } from "vitest";
import { type DiffSeg, trimContext, reviewDiff } from "../../src/lib/reviewDiff";

const join = (segs: DiffSeg[], kinds: string[]): string =>
  segs.filter((s) => kinds.includes(s.kind)).map((s) => s.text).join(" ");

describe("reviewDiff", () => {
  it("marks identical text as one same segment", () => {
    const segs = reviewDiff("the same text", "the same text");
    expect(segs).toEqual([{ kind: "same", text: "the same text" }]);
  });

  it("marks a full replacement as removed + added", () => {
    const segs = reviewDiff("old words here", "brand new phrasing entirely");
    expect(segs.map((s) => s.kind)).toEqual(["removed", "added"]);
  });

  it("isolates a mid-sentence edit", () => {
    const segs = reviewDiff("keep this old middle keep end", "keep this new middle keep end");
    expect(join(segs, ["same", "removed"])).toBe("keep this old middle keep end");
    expect(join(segs, ["same", "added"])).toBe("keep this new middle keep end");
    expect(segs.some((s) => s.kind === "removed" && s.text === "old")).toBe(true);
    expect(segs.some((s) => s.kind === "added" && s.text === "new")).toBe(true);
  });

  it("treats whitespace reflow (newlines vs spaces) as no change", () => {
    const segs = reviewDiff("one two\nthree", "one two three");
    expect(segs).toEqual([{ kind: "same", text: "one two three" }]);
  });
});

describe("trimContext", () => {
  it("keeps only N context words around changes and adds ellipses", () => {
    const before = `${"pad ".repeat(30)}CHANGED ${"pad ".repeat(30)}`.trim();
    const after = `${"pad ".repeat(30)}REWRITTEN ${"pad ".repeat(30)}`.trim();
    const segs = trimContext(reviewDiff(before, after), 5);
    const firstSame = segs.find((s) => s.kind === "same");
    expect(firstSame && firstSame.text.split(" ").length).toBeLessThanOrEqual(6);
    expect(segs[0].text.startsWith("…")).toBe(true);
  });

  it("returns segments unchanged when text is short", () => {
    const segs = reviewDiff("a b c", "a x c");
    expect(trimContext(segs, 12)).toEqual(segs);
  });
});
