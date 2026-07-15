import { describe, expect, it } from "vitest";
import { SHAPE_GROUPS, shapeSuggestionsToIssues } from "../../../src/lib/issues/shapeAdapter";

const result = {
  reword: [{ target: "wordy bit", note: "Tighten this", options: ["Tight one", "Tight two"] }],
  expand: [
    { target: "thin bit", note: "Add substance", options: ["Add a stat", "Add an example"] },
  ],
  fact_check: [{ target: "bold claim", note: "Verify this", options: [] }],
};

describe("shapeSuggestionsToIssues", () => {
  it("maps reword to a fix with option chips", () => {
    const [i] = shapeSuggestionsToIssues({ reword: result.reword });
    expect(i.panel).toBe("shape");
    expect(i.lever).toBe("reword");
    expect(i.nature).toBe("fix");
    expect(i.target).toBe("wordy bit");
    expect(i.options).toEqual(["Tight one", "Tight two"]);
    expect(i.actions).toContain("choose_option");
    expect(i.actions).toContain("dismiss");
  });
  it("maps expand to an add with idea chips", () => {
    const [i] = shapeSuggestionsToIssues({ expand: result.expand });
    expect(i.nature).toBe("add");
    expect(i.options).toEqual(["Add a stat", "Add an example"]);
    expect(i.actions).toContain("choose_option");
  });
  it("maps fact_check to an advisory with no options", () => {
    const [i] = shapeSuggestionsToIssues({ fact_check: result.fact_check });
    expect(i.nature).toBe("advisory");
    expect(i.actions).not.toContain("choose_option");
    expect(i.actions).toEqual(["dismiss"]);
  });
  it("gives every issue a stable, panel-namespaced id", () => {
    const a = shapeSuggestionsToIssues(result);
    const b = shapeSuggestionsToIssues(result);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(a.every((i) => i.id.startsWith("shape:"))).toBe(true);
  });
  it("handles absent kinds", () => {
    expect(shapeSuggestionsToIssues({})).toEqual([]);
  });
  it("exposes groups in a stable order", () => {
    expect(SHAPE_GROUPS.map((g) => g.key)).toEqual(["fact_check", "reword", "expand"]);
  });
});

describe("shapeSuggestionsToIssues — degenerate options", () => {
  it("drops choose_option when a suggestion carries no alternatives", () => {
    // A "Pick one" button with nothing to pick is a dead control.
    const [i] = shapeSuggestionsToIssues({ reword: [{ target: "t", note: "n", options: [] }] });
    expect(i.options).toBeUndefined();
    expect(i.actions).not.toContain("choose_option");
    expect(i.actions).toContain("dismiss");
  });

  it("offers no highlight anywhere — Shape has no section to jump to", () => {
    const all = shapeSuggestionsToIssues({
      reword: [{ target: "a", note: "n", options: ["x"] }],
      expand: [{ target: "b", note: "n", options: ["y"] }],
      fact_check: [{ target: "c", note: "n", options: [] }],
    });
    expect(all.every((i) => !i.actions.includes("highlight"))).toBe(true);
  });

  it("offers dismiss on every suggestion", () => {
    const all = shapeSuggestionsToIssues({
      reword: [{ target: "a", note: "n", options: ["x"] }],
      expand: [{ target: "b", note: "n", options: ["y"] }],
      fact_check: [{ target: "c", note: "n", options: [] }],
    });
    expect(all.every((i) => i.actions.includes("dismiss"))).toBe(true);
  });
});
