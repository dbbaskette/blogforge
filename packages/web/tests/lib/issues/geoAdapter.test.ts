import { describe, expect, it } from "vitest";

import type { GeoReport } from "../../../src/api/geo";
import { geoFindingsToIssues } from "../../../src/lib/issues/geoAdapter";

const report: GeoReport = {
  score: 74,
  grade: "B",
  levers: [
    {
      key: "answer_first",
      label: "Answer-first sections",
      score: 62,
      detail: "Lead with the takeaway.",
      fix: null,
      findings: [
        {
          section_id: "s1",
          target: "There are a few things…",
          note: "Section buries its answer",
          fix: "answer_first",
        },
        {
          section_id: "s2",
          target: "Before we begin…",
          note: "Second weak section",
          fix: "answer_first",
        },
      ],
    },
    {
      key: "freshness",
      label: "Freshness",
      score: 40,
      detail: "Dated evidence signals recency.",
      fix: null,
      findings: [{ note: "No dated evidence found", fix: "" }],
    },
    {
      key: "faq",
      label: "FAQ",
      score: 30,
      detail: "An FAQ gives answer-engines clean Q&A.",
      fix: "faq",
      findings: [{ note: "No FAQ section", fix: "" }],
    },
  ],
};

describe("geoFindingsToIssues", () => {
  it("emits one independently-actionable issue per finding", () => {
    const issues = geoFindingsToIssues(report);
    expect(issues).toHaveLength(4);
    expect(new Set(issues.map((i) => i.id)).size).toBe(4);
  });

  it("maps a fix finding to fix nature with AI/Manual/Highlight", () => {
    const [first] = geoFindingsToIssues(report);
    expect(first.nature).toBe("fix");
    expect(first.actions).toEqual(["ai_fix", "manual_fix", "highlight"]);
    expect(first.target).toBe("There are a few things…");
    expect(first.panel).toBe("geo");
  });

  it("maps freshness to an advisory with Add a date / Dismiss", () => {
    const freshness = geoFindingsToIssues(report).find((i) => i.lever === "freshness");
    expect(freshness?.nature).toBe("advisory");
    expect(freshness?.actions).toContain("dismiss");
    expect(freshness?.actions).toContain("add_date");
  });

  it("maps a missing-FAQ lever to an add issue with Generate / Write my own", () => {
    const faq = geoFindingsToIssues(report).find((i) => i.lever === "faq");
    expect(faq?.nature).toBe("add");
    expect(faq?.actions).toEqual(["generate", "write_own"]);
  });

  it("makes factual_density actionable (add a fact) and tags a fixKind", () => {
    const issues = geoFindingsToIssues({
      score: 50,
      grade: "D",
      levers: [
        {
          key: "factual_density",
          label: "Factual density",
          score: 55,
          detail: "Back claims with real data.",
          fix: null,
          findings: [{ section_id: "s1", target: "a vague claim", note: "Thin on data" }],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].nature).toBe("fix");
    expect(issues[0].actions).toContain("add_fact");
    expect(issues[0].fixKind).toBe("factual_density");
  });
});
