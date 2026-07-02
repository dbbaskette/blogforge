import { describe, expect, it } from "vitest";

import type { LintFinding } from "../../../src/api/drafts";
import { proofreadFindingsToIssues } from "../../../src/lib/issues/proofreadAdapter";

const violation: LintFinding = {
  id: "v1",
  kind: "violation",
  section_id: "s1",
  start: 4,
  end: 8,
  match: "very",
  rule: "banished_word",
  message: "Banished word: 'very'",
};
const unlocated: LintFinding = {
  id: "v2",
  kind: "violation",
  section_id: null,
  start: null,
  end: null,
  match: "",
  rule: "structure",
  message: "Consider a stronger opener",
};
const repetition: LintFinding = {
  id: "r1",
  kind: "repetition",
  section_id: "s2",
  start: 0,
  end: 10,
  match: "in order to",
  rule: "repetition",
  message: "Repeated phrasing: 'in order to'",
};

describe("proofreadFindingsToIssues", () => {
  it("maps violations + repetitions to fix issues (hits excluded)", () => {
    const issues = proofreadFindingsToIssues({
      violations: [violation, unlocated],
      repetitions: [repetition],
      hits: [{ ...violation, id: "h1", kind: "hit" }],
    });
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.panel === "proofread")).toBe(true);
    expect(issues[0].nature).toBe("fix");
    expect(issues[0].actions).toEqual(["ai_fix", "manual_fix", "highlight", "dismiss"]);
    expect(issues[0].target).toBe("very");
  });

  it("gives unlocated findings only a Dismiss action", () => {
    const [, second] = proofreadFindingsToIssues({
      violations: [violation, unlocated],
      repetitions: [],
    });
    expect(second.actions).toEqual(["dismiss"]);
    expect(second.target).toBeUndefined();
  });
});
