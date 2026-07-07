import { describe, expect, it } from "vitest";
import { humanizeFindingsToIssues } from "../../../src/lib/issues/humanizeAdapter";
import type { HumanizeReport } from "../../../src/api/humanize";

const report: HumanizeReport = {
  intensity: "medium",
  score: 88,
  lenses: [
    {
      key: "soul",
      label: "De-robot / Soul",
      findings: [
        { lens: "soul", section_id: "s1", target: "The API serves as a gateway.",
          suggestion: "The API is the gateway.", note: "puffery", needs_review: false },
        { lens: "soul", section_id: "s2", target: "Freed 11 GB.",
          suggestion: "Freed 12 GB.", note: "loosen", needs_review: true },
      ],
    },
  ],
};

describe("humanizeFindingsToIssues", () => {
  it("maps findings to humanize-panel issues with target + actions", () => {
    const issues = humanizeFindingsToIssues(report);
    expect(issues).toHaveLength(2);
    expect(issues[0].panel).toBe("humanize");
    expect(issues[0].sectionId).toBe("s1");
    expect(issues[0].target).toBe("The API serves as a gateway.");
    expect(issues[0].lever).toBe("soul");
    expect(issues[0].actions).toContain("ai_fix");
    expect(issues[0].actions).toContain("dismiss");
  });

  it("gates needs_review findings: advisory nature AND no one-click ai_fix", () => {
    const issues = humanizeFindingsToIssues(report);
    // safe finding keeps the one-click fix
    expect(issues[0].nature).toBe("fix");
    expect(issues[0].actions).toContain("ai_fix");
    // fact-changing finding is advisory and cannot be auto-applied — the writer
    // must open it via manual_fix (guardrail).
    expect(issues[1].nature).toBe("advisory");
    expect(issues[1].actions).not.toContain("ai_fix");
    expect(issues[1].actions).toContain("manual_fix");
  });
});
