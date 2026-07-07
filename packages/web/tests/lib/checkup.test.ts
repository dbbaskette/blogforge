import { describe, expect, it } from "vitest";

import type { GeoReport } from "../../src/api/geo";
import type { HumanizeReport } from "../../src/api/humanize";
import type { SuggestResult } from "../../src/api/suggest";
import { type LintResult, blendHumanness, humanityScore, summarizeCheckup } from "../../src/lib/checkup";

const lint = (violations: number, repetitions = 0, hits = 0): LintResult => ({
  // biome-ignore lint/suspicious/noExplicitAny: minimal finding stubs
  violations: Array.from({ length: violations }, () => ({}) as any),
  // biome-ignore lint/suspicious/noExplicitAny: minimal finding stubs
  repetitions: Array.from({ length: repetitions }, () => ({}) as any),
  // biome-ignore lint/suspicious/noExplicitAny: minimal finding stubs
  hits: Array.from({ length: hits }, () => ({}) as any),
});

const geo = (grade: string, fixes: number): GeoReport => ({
  score: 0,
  grade,
  levers: [
    {
      key: "a",
      label: "A",
      score: 0,
      detail: "",
      // biome-ignore lint/suspicious/noExplicitAny: minimal finding stubs
      findings: Array.from({ length: fixes }, () => ({ note: "" }) as any),
      fix: null,
    },
  ],
});

const shape = (n: number): SuggestResult => ({
  // biome-ignore lint/suspicious/noExplicitAny: minimal suggestion stubs
  reword: Array.from({ length: n }, () => ({}) as any),
});

const humanize = (score: number, findingCounts: number[]): HumanizeReport => ({
  intensity: "medium",
  score,
  lenses: findingCounts.map((n, i) => ({
    key: `lens${i}`,
    label: `Lens ${i}`,
    // biome-ignore lint/suspicious/noExplicitAny: minimal finding stubs
    findings: Array.from({ length: n }, () => ({}) as any),
  })),
});

describe("humanityScore", () => {
  it("drops with open issues and floors at 0", () => {
    expect(humanityScore(0, 0)).toBe(100);
    expect(humanityScore(3, 0)).toBe(82);
    expect(humanityScore(50, 0)).toBe(0);
  });
});

describe("blendHumanness", () => {
  it("returns the anti-robot score when Humanize has not run", () => {
    expect(blendHumanness(80, null)).toBe(80);
  });
  it("averages the two sub-scores 50/50 when both present", () => {
    expect(blendHumanness(80, 60)).toBe(70);
  });
  it("clamps to 0..100", () => {
    expect(blendHumanness(0, 0)).toBe(0);
    expect(blendHumanness(100, 100)).toBe(100);
  });
});

describe("summarizeCheckup", () => {
  it("prioritizes voice-rule issues in the headline", () => {
    const s = summarizeCheckup(lint(2), geo("A", 0), shape(0), null);
    expect(s.headline).toBe("Needs a cleanup pass");
    expect(s.rows[0].key).toBe("review");
    expect(s.rows[0].severity).toBe("bad");
    expect(s.rows[0].detail).toBe("2 voice-rule issues");
  });

  it("flags structure when clean but low GEO grade", () => {
    const s = summarizeCheckup(lint(0), geo("F", 4), shape(1), null);
    expect(s.headline).toBe("Structure needs work");
    expect(s.rows[1].detail).toBe("Grade F · 4 fixes");
    expect(s.rows[1].severity).toBe("bad");
  });

  it("declares ready when everything is clean", () => {
    const s = summarizeCheckup(lint(0), geo("A", 0), shape(0), null);
    expect(s.headline).toBe("Looks clean — ready to publish");
    expect(s.totalOpen).toBe(0);
    expect(s.humanity).toBe(100);
  });

  it("sums totals, singularizes counts, and reads 'almost ready' when clean but with tweaks", () => {
    const s = summarizeCheckup(lint(0), geo("B", 1), shape(1), null);
    expect(s.rows[1].detail).toBe("Grade B · 1 fix");
    expect(s.rows[2].detail).toBe("1 suggestion");
    expect(s.totalOpen).toBe(2);
    expect(s.headline).toBe("Almost ready — a few tweaks left");
  });

  it("singularizes a lone voice-rule issue", () => {
    const s = summarizeCheckup(lint(1), geo("A", 0), shape(0), null);
    expect(s.rows[0].detail).toBe("1 voice-rule issue");
    expect(s.headline).toBe("Needs a cleanup pass");
  });

  it("handles a not-yet-scored GEO gracefully", () => {
    const s = summarizeCheckup(lint(0), null, null, null);
    expect(s.rows[1].detail).toBe("Not scored yet");
    expect(s.rows[1].severity).toBe("warn");
  });

  it("adds a humanize row and blends the humanity score when a Humanize report is present", () => {
    const s = summarizeCheckup(lint(0), null, null, humanize(60, [2, 1]));
    const row = s.rows[3];
    expect(row.key).toBe("humanize");
    expect(row.label).toBe("Humanness");
    expect(row.count).toBe(3);
    expect(row.severity).toBe("warn"); // score 60 -> mid band
    // humanityScore(0, 0) is 100 (clean lint); blended 50/50 with a 60 human-signal -> 80.
    expect(s.humanity).toBe(80);
  });
});
