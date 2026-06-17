import { describe, expect, it } from "vitest";

import { parseOutline } from "../../src/lib/parseOutline";

describe("parseOutline", () => {
  it("parses an H1 title + H2 sections with briefs", () => {
    const r = parseOutline(
      "# The cost of convenience\n## The promise\nWhat we were sold\n## The reckoning\n",
    );
    expect(r.title).toBe("The cost of convenience");
    expect(r.sections).toEqual([
      { title: "The promise", brief: "What we were sold" },
      { title: "The reckoning", brief: "" },
    ]);
  });

  it("treats top-level bullets as sections and nested bullets as brief", () => {
    const r = parseOutline("My topic\n- First point\n  - detail a\n  - detail b\n- Second point");
    expect(r.title).toBe("My topic");
    expect(r.sections).toEqual([
      { title: "First point", brief: "detail a\ndetail b" },
      { title: "Second point", brief: "" },
    ]);
  });

  it("supports numbered lists as sections", () => {
    const r = parseOutline("Title line\n1. Alpha\n2. Beta");
    expect(r.sections.map((s) => s.title)).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to each non-empty line as a section when no markers", () => {
    const r = parseOutline("My title\nPlain one\nPlain two");
    expect(r.title).toBe("My title");
    expect(r.sections.map((s) => s.title)).toEqual(["Plain one", "Plain two"]);
  });

  it("returns the single line as title with zero sections", () => {
    const r = parseOutline("  Just a topic  ");
    expect(r.title).toBe("Just a topic");
    expect(r.sections).toEqual([]);
  });

  it("handles empty input", () => {
    expect(parseOutline("   \n  ")).toEqual({ title: "", sections: [] });
  });
});
