import { describe, expect, it } from "vitest";
import { sentenceLengths, rhythmVariance } from "../../src/components/draft/RhythmStrip";

describe("RhythmStrip math", () => {
  it("splits into per-sentence word counts", () => {
    expect(sentenceLengths("One two three. Four five!")).toEqual([3, 2]);
  });
  it("uniform sentences have low variance, varied ones high", () => {
    const uniform = rhythmVariance([5, 5, 5, 5]);
    const varied = rhythmVariance([2, 14, 3, 11]);
    expect(varied).toBeGreaterThan(uniform);
  });
});
