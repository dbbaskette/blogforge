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
    expect(first.actions).toEqual(["ai_fix", "manual_fix", "highlight", "dismiss"]);
    expect(first.target).toBe("There are a few things…");
    expect(first.panel).toBe("geo");
  });

  it("keeps answer_first actionable when the per-finding fix came back empty", () => {
    // When the backend can't match a paraphrased section title it drops the
    // per-finding fix, but the lever still tags fix:'answer_first' — LEVER_FIX
    // must rescue it into an AI-fixable card rather than an advisory Dismiss.
    const issues = geoFindingsToIssues({
      score: 50,
      grade: "D",
      levers: [
        {
          key: "answer_first",
          label: "Answer-first sections",
          score: 58,
          detail: "Lead with the takeaway.",
          fix: "answer_first",
          findings: [{ note: "A section buries its answer", fix: "" }],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].nature).toBe("fix");
    expect(issues[0].actions).toContain("ai_fix");
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
    expect(faq?.actions).toEqual(["generate", "write_own", "dismiss"]);
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

  it("drops Highlight from a finding with neither a target nor a section", () => {
    const issues = geoFindingsToIssues({
      score: 40,
      grade: "D",
      levers: [
        {
          key: "freshness",
          label: "Freshness",
          score: 40,
          detail: "Dated evidence signals recency.",
          fix: null,
          findings: [{ note: "No dates anywhere", fix: "" }],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].actions).not.toContain("highlight");
    expect(issues[0].actions).toContain("add_date");
  });

  it("synthesizes a card for a deficient lever whose fix has no per-finding anchor", () => {
    const issues = geoFindingsToIssues({
      score: 45,
      grade: "D",
      levers: [
        {
          key: "takeaways",
          label: "Key takeaways",
          score: 45,
          detail: "A key-takeaways block is the most-lifted extraction target.",
          fix: "takeaways",
          findings: [],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    // Id is now content-hashed, not position/suffix-based — assert the shape
    // (stable, namespaced under panel:lever) rather than a literal string.
    expect(issues[0].id).toMatch(/^geo:takeaways:/);
    expect(issues[0].nature).toBe("add");
    expect(issues[0].actions).toEqual(["generate", "write_own", "dismiss"]);
    expect(issues[0].fixKind).toBe("takeaways");
  });

  it("offers a one-click AI fix for a citations claim matched to an attached source", () => {
    const issues = geoFindingsToIssues({
      score: 55,
      grade: "C",
      levers: [
        {
          key: "citations",
          label: "Cited sources",
          score: 60,
          detail: "1 source attached; 0 cited in-text.",
          fix: null,
          findings: [
            {
              section_id: "s1",
              target: "Latency dropped 40 percent.",
              note: "matches your attached: Tanzu 10.4 release notes",
              suggestion:
                "Latency dropped 40 percent, per the [Tanzu 10.4 release notes](https://x).",
              matched_source_url: "https://x",
              fix: "cite_reference",
            },
          ],
        },
      ],
    } as unknown as GeoReport);
    expect(issues).toHaveLength(1);
    expect(issues[0].actions).toContain("ai_fix");
    expect(issues[0].suggestion).toContain("[Tanzu 10.4 release notes]");
  });

  it("keeps the manual cite flow for an unmatched claim (no suggestion)", () => {
    const issues = geoFindingsToIssues({
      score: 40,
      grade: "D",
      levers: [
        {
          key: "citations",
          label: "Cited sources",
          score: 40,
          detail: "claims lack sources",
          fix: null,
          findings: [
            {
              section_id: "s1",
              target: "It is fast.",
              note: "add a dated benchmark for the latency claim",
              fix: "cite_reference",
            },
          ],
        },
      ],
    } as unknown as GeoReport);
    expect(issues[0].actions).toEqual(["cite_source", "highlight", "dismiss"]);
  });

  it("maps finding impact, falling back to the lever impact", () => {
    const report = {
      score: 50,
      grade: "C",
      levers: [
        {
          key: "sound_bites",
          label: "Liftable sound bites",
          score: 45,
          weight: 0.03,
          detail: "few",
          impact: "Engines lift single sentences verbatim.",
          fix: null,
          findings: [
            { note: "no liftable line", target: "x", impact: "Specific impact." },
            { note: "another", target: "y" },
          ],
        },
      ],
    } as unknown as GeoReport;
    const issues = geoFindingsToIssues(report);
    expect(issues[0].impact).toBe("Specific impact.");
    expect(issues[1].impact).toBe("Engines lift single sentences verbatim.");
  });
});

describe("geoAdapter — universal dismiss", () => {
  it("offers dismiss on every finding, so nothing can nag forever", () => {
    const report = {
      grade: "C",
      levers: [
        {
          key: "answer_first",
          label: "Answer first",
          score: 40,
          weight: 0.2,
          detail: "Buried answers",
          findings: [{ note: "Buried", fix: "answer_first", target: "t", section_id: "s1" }],
        },
        {
          key: "citations",
          label: "Citations",
          score: 30,
          weight: 0.2,
          detail: "No sources",
          findings: [{ note: "Uncited", fix: "cite_reference", target: "c", section_id: "s1" }],
        },
      ],
    } as never;
    const issues = geoFindingsToIssues(report);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.actions.includes("dismiss"))).toBe(true);
  });

  it("offers dismiss on the matched-citation shortcut too", () => {
    // This path bypasses the action tables with a hardcoded override, so it can
    // (and did) silently miss dismiss even when every table entry has it.
    const report = {
      grade: "C",
      levers: [
        {
          key: "citations",
          label: "Citations",
          score: 30,
          weight: 0.2,
          detail: "No sources",
          findings: [
            {
              note: "Uncited",
              fix: "cite_reference",
              target: "c",
              section_id: "s1",
              suggestion: "c [src](http://x)",
            },
          ],
        },
      ],
    } as never;
    const [i] = geoFindingsToIssues(report);
    expect(i.actions).toEqual(["ai_fix", "manual_fix", "highlight", "dismiss"]);
  });
});
