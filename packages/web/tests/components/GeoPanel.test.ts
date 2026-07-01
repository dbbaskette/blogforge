import { describe, expect, it } from "vitest";

import { type Additions, carveProtectedAdditions } from "../../src/components/draft/GeoPanel";

const OPENER = "BlogForge is a drafting tool that keeps your voice.";
const FAQ = "### FAQ\n\n**What is it?**\n\nA tool.";

describe("carveProtectedAdditions", () => {
  it("carves a tracked opener at the start into the prefix", () => {
    const additions: Additions = { opener: { sectionId: "s1", text: OPENER } };
    const content = `${OPENER}\n\nThe rest of the section.`;
    const { core, prefix, suffix } = carveProtectedAdditions(additions, "s1", content);
    expect(prefix).toBe(`${OPENER}\n\n`);
    expect(core).toBe("The rest of the section.");
    expect(suffix).toBe("");
    // Reassembly restores the addition verbatim around a rewritten core.
    expect(`${prefix}REWRITTEN${suffix}`).toContain(OPENER);
  });

  it("carves a tracked FAQ block at the end into the suffix", () => {
    const additions: Additions = { faq: { sectionId: "s1", text: FAQ } };
    const content = `Body text.\n\n${FAQ}`;
    const { core, prefix, suffix } = carveProtectedAdditions(additions, "s1", content);
    expect(core).toBe("Body text.");
    expect(prefix).toBe("");
    expect(suffix).toBe(`\n\n${FAQ}`);
  });

  it("carves both opener and FAQ from the same section", () => {
    const additions: Additions = {
      opener: { sectionId: "s1", text: OPENER },
      faq: { sectionId: "s1", text: FAQ },
    };
    const content = `${OPENER}\n\nMiddle prose.\n\n${FAQ}`;
    const { core, prefix, suffix } = carveProtectedAdditions(additions, "s1", content);
    expect(core).toBe("Middle prose.");
    expect(`${prefix}${core}${suffix}`).toBe(content);
  });

  it("leaves content alone for a different section", () => {
    const additions: Additions = { opener: { sectionId: "s1", text: OPENER } };
    const content = "Unrelated section body.";
    const { core, prefix, suffix } = carveProtectedAdditions(additions, "s2", content);
    expect(core).toBe(content);
    expect(prefix).toBe("");
    expect(suffix).toBe("");
  });

  it("does not carve an opener the writer moved away from the start", () => {
    const additions: Additions = { opener: { sectionId: "s1", text: OPENER } };
    const content = `Some intro first.\n\n${OPENER}`;
    const { core, prefix } = carveProtectedAdditions(additions, "s1", content);
    expect(core).toBe(content);
    expect(prefix).toBe("");
  });
});
