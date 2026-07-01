import { beforeEach, describe, expect, it } from "vitest";

import { readDraftHealth } from "../../src/lib/draftHealth";
import { setCached } from "../../src/lib/panelCache";

describe("readDraftHealth", () => {
  beforeEach(() => localStorage.clear());

  it("derives a next-step nudge from the stage with no cached analysis", () => {
    expect(readDraftHealth("d1", "research").nextStep).toBe("Add an outline");
    expect(readDraftHealth("d1", "outline").nextStep).toBe("Write the sections");
    const h = readDraftHealth("d1", "sections");
    expect(h.nextStep).toBe("Review & polish");
    expect(h.geoGrade).toBeUndefined();
    expect(h.fixes).toBe(0);
    expect(h.at).toBeNull();
  });

  it("surfaces the GEO grade and sums open fixes across GEO + Shape caches", () => {
    setCached(
      "geo",
      "d1",
      "h",
      {
        score: 62,
        grade: "C",
        levers: [
          {
            key: "a",
            label: "A",
            score: 50,
            detail: "",
            findings: [{ note: "x" }, { note: "y" }],
            fix: null,
          },
          { key: "b", label: "B", score: 70, detail: "", findings: [{ note: "z" }], fix: null },
        ],
      },
      1000,
    );
    setCached(
      "shape",
      "d1",
      "h",
      {
        reword: [{ target: "a", note: "", options: [] }],
        expand: [{ target: "b", note: "", options: [] }],
      },
      2000,
    );
    const h = readDraftHealth("d1", "sections");
    expect(h.geoGrade).toBe("C");
    expect(h.geoScore).toBe(62);
    // 3 GEO findings + 2 Shape suggestions.
    expect(h.fixes).toBe(5);
    expect(h.at).toBe(2000);
  });
});
