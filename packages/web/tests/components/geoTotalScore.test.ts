import { describe, expect, it } from "vitest";

import { computeTotalScore } from "../../src/components/draft/GeoPanel";

const LEVERS = [
  "answer_first",
  "factual_density",
  "definitional_opener",
  "brand_explicit",
  "question_headings",
  "skimmability",
  "comparison_table",
  "faq",
  "chunking",
];

const all = (
  score: number,
  withWeight = false,
): { key: string; score: number; weight?: number }[] =>
  LEVERS.map((key) => (withWeight ? { key, score, weight: 0 } : { key, score }));

describe("computeTotalScore", () => {
  it("is the weighted average of the levers (weights sum to 1)", () => {
    expect(computeTotalScore(all(100))).toBe(100);
    expect(computeTotalScore(all(0))).toBe(0);
    expect(computeTotalScore(all(60))).toBe(60);
  });

  it("moves the total when one lever's score changes (rescore updates the total)", () => {
    const before = computeTotalScore(all(60));
    const after = computeTotalScore(
      all(60).map((l) => (l.key === "answer_first" ? { ...l, score: 100 } : l)),
    );
    expect(after).toBeGreaterThan(before);
  });

  it("still computes from a report whose levers carry no usable weight (cache resilience)", () => {
    // A report cached by an older bundle can have weight:0 (or missing). The
    // frontend weights table still yields the correct total — this is the bug.
    expect(computeTotalScore(all(80, true))).toBe(80);
  });

  it("normalizes by present weights (partial report isn't diluted)", () => {
    // Only two levers present → weighted mean of just those two, matching the
    // backend. (100*.16 + 50*.06) / (.16+.06) = 86.36 → 86.
    const total = computeTotalScore([
      { key: "answer_first", score: 100 },
      { key: "faq", score: 50 },
    ]);
    expect(total).toBe(86);
  });
});
