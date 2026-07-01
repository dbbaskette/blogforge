import { describe, expect, it } from "vitest";

import {
  type Additions,
  carveProtectedAdditions,
  dedupeOpeningBlock,
  openerPresence,
  stripDuplicateTitleHeading,
} from "../../src/components/draft/GeoPanel";

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

describe("stripDuplicateTitleHeading", () => {
  const TITLE = "Faster is Still Safer";

  it("strips a heading that repeats the draft title", () => {
    const { rest, removed } = stripDuplicateTitleHeading(
      TITLE,
      `## Faster is Still Safer\n\nThe body starts here.`,
    );
    expect(removed).toBe("## Faster is Still Safer");
    expect(rest).toBe("The body starts here.");
  });

  it("matches loosely: quotes, bold, punctuation, case", () => {
    const { rest, removed } = stripDuplicateTitleHeading(
      TITLE,
      `**"faster is still safer"**\n\nBody.`,
    );
    expect(removed).toBe(`**"faster is still safer"**`);
    expect(rest).toBe("Body.");
  });

  it("leaves a genuine opening line alone", () => {
    const content = "Speed is the best defense.\n\nMore body.";
    const { rest, removed } = stripDuplicateTitleHeading(TITLE, content);
    expect(removed).toBe("");
    expect(rest).toBe(content);
  });

  it("leaves a non-duplicate heading alone", () => {
    const content = "## Why speed wins\n\nBody.";
    const { rest, removed } = stripDuplicateTitleHeading(TITLE, content);
    expect(removed).toBe("");
    expect(rest).toBe(content);
  });
});

describe("openerPresence", () => {
  it("detects a verbatim opener already in the content", () => {
    expect(openerPresence(OPENER, `${OPENER}\n\nMore body.`)).toBe("exact");
  });

  it("detects an equivalent opener despite quote glyphs and case", () => {
    const content = `“blogforge IS a drafting tool that keeps your voice.”\n\nMore body.`;
    expect(openerPresence(OPENER, content)).toBe("similar");
  });

  it("returns null when no equivalent opener exists near the top", () => {
    expect(openerPresence(OPENER, "A totally different opening line.\n\nBody.")).toBeNull();
    expect(openerPresence("", "anything")).toBeNull();
  });
});

describe("dedupeOpeningBlock", () => {
  it("keeps only the first copy of a duplicated block", () => {
    const block = `${OPENER} ${OPENER}`;
    expect(dedupeOpeningBlock(block)).toBe(OPENER);
  });

  it("keeps the first copy's closing quote", () => {
    const quoted = `“${OPENER}”`;
    const block = `${quoted}\n\n${quoted}`;
    expect(dedupeOpeningBlock(block)).toBe(quoted);
  });

  it("returns a single-sentence block unchanged", () => {
    expect(dedupeOpeningBlock(OPENER)).toBe(OPENER);
  });
});
