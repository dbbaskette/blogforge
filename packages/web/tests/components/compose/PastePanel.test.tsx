import { describe, expect, it } from "vitest";

import { countSections } from "../../../src/components/compose/PastePanel";

describe("countSections", () => {
  it("returns 0 for empty/whitespace", () => {
    expect(countSections("")).toBe(0);
    expect(countSections("   \n  ")).toBe(0);
  });

  it("counts one section when there are no headings", () => {
    expect(countSections("Just some prose.\n\nMore prose.")).toBe(1);
  });

  it("counts one section per H2 heading", () => {
    expect(countSections("# Title\n\n## One\n\nx\n\n## Two\n\ny\n\n## Three\n\nz")).toBe(3);
  });

  it("ignores H1 and H3 when counting sections", () => {
    expect(countSections("# Title\n\nlead\n\n## Only\n\n### sub\n\nbody")).toBe(1);
  });
});
