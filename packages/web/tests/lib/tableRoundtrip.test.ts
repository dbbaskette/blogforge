import { marked } from "marked";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";
import { describe, expect, it } from "vitest";

// The section editor round-trips markdown → HTML → markdown. Without the GFM
// tables rule, turndown flattens a table's cells into concatenated text — which
// is how generated comparison tables lost all formatting. These lock the fix.
describe("markdown table round-trip", () => {
  const md = "| Option | Cost |\n| --- | --- |\n| A | $1 |\n| B | $2 |";

  it("preserves a table through marked → turndown(+gfm tables)", () => {
    const html = marked.parse(md) as string;
    const td = new TurndownService({ headingStyle: "atx" });
    td.use(tables);
    const back = td.turndown(html);
    expect(back).toMatch(/\|\s*Option\s*\|\s*Cost\s*\|/);
    expect(back).toMatch(/\|\s*-{3}/); // the |---| separator row survives
    expect(back).toContain("$1");
  });

  it("WITHOUT the gfm rule the table is flattened (the reported bug)", () => {
    const html = marked.parse(md) as string;
    const flattened = new TurndownService().turndown(html);
    expect(flattened).not.toContain("|"); // cells concatenated, no table
  });
});
