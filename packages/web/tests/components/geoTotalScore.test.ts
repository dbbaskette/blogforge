import { describe, expect, it } from "vitest";

import { computeTotalScore } from "../../src/components/draft/geoScore";

// A representative subset of the backend's live per-lever weights (see
// _WEIGHTS in geo.py) — including a lever added after the original launch
// (definitive_language) to prove the client needs no hardcoded mirror to
// weight it correctly.
const WEIGHTED_LEVERS = [
  { key: "answer_first", weight: 0.09 },
  { key: "factual_density", weight: 0.07 },
  { key: "citations", weight: 0.06 },
  { key: "faq", weight: 0.02 },
  { key: "definitive_language", weight: 0.02 },
];

const all = (score: number): { key: string; score: number; weight: number }[] =>
  WEIGHTED_LEVERS.map(({ key, weight }) => ({ key, score, weight }));

describe("computeTotalScore", () => {
  it("is the weighted average of the levers' own weights", () => {
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

  it("uses each lever's own `weight` field, not a hardcoded table (regression: stale LEVER_WEIGHTS mirror removed)", () => {
    // Keys that never appeared in any hardcoded mirror (e.g. brand-new
    // levers) must still count correctly, using whatever weight they carry.
    const total = computeTotalScore([
      { key: "brand_new_lever_not_in_any_table", score: 100, weight: 0.5 },
      { key: "another_new_lever", score: 0, weight: 0.5 },
    ]);
    expect(total).toBe(50);
  });

  it("treats a missing weight as zero contribution (no fallback table to paper over it)", () => {
    // Before the fix, a stale hardcoded table could substitute its own value
    // for a lever missing `weight`. Now the lever's own `weight` is the only
    // source of truth, so an absent weight contributes nothing to the total.
    const total = computeTotalScore([
      { key: "answer_first", score: 100 }, // no weight -> contributes 0
      { key: "faq", score: 80, weight: 1 },
    ]);
    expect(total).toBe(80);
  });

  it("normalizes by present weights (partial report isn't diluted)", () => {
    // Only two levers present → weighted mean of just those two, matching the
    // backend. (100*.16 + 50*.06) / (.16+.06) = 86.36 → 86.
    const total = computeTotalScore([
      { key: "answer_first", score: 100, weight: 0.16 },
      { key: "faq", score: 50, weight: 0.06 },
    ]);
    expect(total).toBe(86);
  });
});
