import { describe, expect, it } from "vitest";

import type { GeoReport } from "../../src/api/geo";
import type { HumanizeReport } from "../../src/api/humanize";
import type { SuggestResult } from "../../src/api/suggest";
import {
  type FactualSupportResult,
  type LintResult,
  type ReviewCheck,
  type ReviewResults,
  isCurrentReviewSummary,
  markReviewStale,
  summarizeReview,
} from "../../src/lib/reviewCenter";

const current = <T>(data: T): ReviewCheck<T> => ({ status: "current", data });

const lint = (sectionId = "proof-section"): LintResult => ({
  violations: [
    {
      id: "v1",
      kind: "violation",
      section_id: sectionId,
      start: 0,
      end: 5,
      match: "Draft",
      rule: "voice",
      message: "Use a more direct phrase.",
    },
  ],
  repetitions: [],
  hits: [],
});

const facts = (hasReferences = true): FactualSupportResult => ({
  has_references: hasReferences,
  claims: [
    { text: "Supported", status: "supported", note: "Found in source." },
    { text: "Needs a source", status: "unsupported", note: "No source match." },
    { text: "Conflicts", status: "contradicted", note: "Source disagrees." },
  ],
});

const shape: SuggestResult = {
  reword: [{ target: "wordy", note: "Tighten it.", options: ["direct"] }],
};

const humanize: HumanizeReport = {
  intensity: "medium",
  score: 80,
  lenses: [
    {
      key: "flow",
      label: "Flow",
      findings: [
        {
          lens: "flow",
          section_id: "human-section",
          target: "The sentence",
          suggestion: "A better sentence",
          note: "Vary the rhythm.",
          needs_review: true,
        },
      ],
    },
  ],
};

const geo: GeoReport = {
  score: 65,
  grade: "C",
  levers: [
    {
      key: "answer_first",
      label: "Answer first",
      score: 65,
      detail: "Lead with the answer.",
      findings: [{ section_id: "geo-section", note: "The answer is buried." }],
      fix: null,
    },
  ],
};

function completeResults(): ReviewResults {
  return {
    proofread: current(lint()),
    factualSupport: current(facts()),
    shape: current(shape),
    humanization: current(humanize),
    geo: current(geo),
  };
}

describe("summarizeReview", () => {
  it("keeps the five checks in editorial priority order", () => {
    const summary = summarizeReview(completeResults());

    expect(summary.rows.map((row) => row.key)).toEqual([
      "proofread",
      "factual-support",
      "shape",
      "humanization",
      "geo",
    ]);
    expect(summary.rows.map((row) => row.status)).toEqual([
      "current",
      "current",
      "current",
      "current",
      "current",
    ]);
  });

  it("counts unsupported and contradicted claims as factual-support concerns", () => {
    const row = summarizeReview(completeResults()).rows[1];

    expect(row.label).toBe("Factual support");
    expect(row.count).toBe(2);
    expect(row.detail).toBe("2 claims need attention");
  });

  it("reports factual support as unavailable when the draft has no references", () => {
    const summary = summarizeReview({
      ...completeResults(),
      factualSupport: current(facts(false)),
    });

    expect(summary.rows[1]).toMatchObject({
      key: "factual-support",
      status: "unavailable",
      count: 0,
      detail: "Attach references before checking factual support.",
    });
  });

  it("preserves successful rows and section anchors when one check fails", () => {
    const failure = new Error("provider rejected request");
    const summary = summarizeReview({
      ...completeResults(),
      humanization: { status: "failed", error: failure },
    });

    expect(summary.rows[0]).toMatchObject({ status: "current", sectionId: "proof-section" });
    expect(summary.rows[3]).toMatchObject({ status: "failed", error: failure });
    expect(summary.rows[4]).toMatchObject({ status: "current", sectionId: "geo-section" });
    expect(summary.rows.filter((row) => row.status === "current")).toHaveLength(4);
  });
});

describe("markReviewStale", () => {
  it("marks completed rows stale without changing failed or unavailable rows", () => {
    const summary = summarizeReview({
      ...completeResults(),
      factualSupport: current(facts(false)),
      humanization: { status: "failed", error: new Error("offline") },
    });

    const stale = markReviewStale(summary);

    expect(stale.rows.map((row) => row.status)).toEqual([
      "stale",
      "unavailable",
      "stale",
      "failed",
      "stale",
    ]);
    expect(stale.totalOpen).toBe(summary.totalOpen);
  });
});

describe("isCurrentReviewSummary", () => {
  it("rejects summaries from the content-only cache version", () => {
    const legacy = { ...summarizeReview(completeResults()), version: 1 };

    expect(isCurrentReviewSummary(legacy)).toBe(false);
  });
});
