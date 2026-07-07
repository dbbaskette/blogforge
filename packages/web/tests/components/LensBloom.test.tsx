import { describe, expect, it } from "vitest";
import { radiiForLenses } from "../../src/components/draft/LensBloom";

describe("radiiForLenses", () => {
  it("engaged lenses reach farther than idle ones", () => {
    const r = radiiForLenses(["flow", "soul"], { flow: 2, voice: 0, imperfections: 0, soul: 1 });
    expect(r.flow).toBeGreaterThan(r.voice);
    expect(r.soul).toBeGreaterThan(r.imperfections);
  });
  it("idle lenses sit near the center", () => {
    const r = radiiForLenses(["flow"], { flow: 0, voice: 0, imperfections: 0, soul: 0 });
    expect(r.voice).toBeLessThanOrEqual(0.2);
  });
});
