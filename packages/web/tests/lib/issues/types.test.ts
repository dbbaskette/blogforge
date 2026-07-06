import { describe, expect, it } from "vitest";

import { type Issue, isFixNature, isInputAction } from "../../../src/lib/issues/types";

const base: Issue = {
  id: "i1",
  panel: "geo",
  lever: "answer_first",
  title: "This section buries its answer",
  why: "Lead with the takeaway.",
  nature: "fix",
  sectionId: "s1",
  target: "There are a few things…",
  actions: ["ai_fix", "manual_fix", "highlight"],
  status: "open",
};

describe("Issue model", () => {
  it("classifies fix vs non-fix natures", () => {
    expect(isFixNature(base)).toBe(true);
    expect(isFixNature({ ...base, nature: "add" })).toBe(false);
    expect(isFixNature({ ...base, nature: "advisory" })).toBe(false);
  });

  it("knows which actions open an inline editor", () => {
    expect(isInputAction("manual_fix")).toBe(true);
    expect(isInputAction("write_own")).toBe(true);
    expect(isInputAction("add_fact")).toBe(true);
    expect(isInputAction("add_date")).toBe(true);
    expect(isInputAction("cite_source")).toBe(true);
    expect(isInputAction("ai_fix")).toBe(false);
    expect(isInputAction("generate")).toBe(false);
    expect(isInputAction("highlight")).toBe(false);
  });
});
