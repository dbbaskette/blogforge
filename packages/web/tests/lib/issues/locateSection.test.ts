import { describe, expect, it } from "vitest";

import { fillSectionIds, sectionForTarget } from "../../../src/lib/issues/locateSection";
import type { Issue } from "../../../src/lib/issues/types";

const sections = [
  { id: "s1", content_md: "MeetingNotes captures audio locally and transcribes on device." },
  { id: "s2", content_md: "Cold-start latency ranged from 200 to 800 milliseconds in testing." },
  { id: "s3", content_md: "The license grants you ownership of your own recordings and exports." },
];

describe("sectionForTarget", () => {
  it("matches an exact substring", () => {
    expect(sectionForTarget("transcribes on device", sections)).toBe("s1");
  });

  it("matches despite whitespace/case drift (normalized)", () => {
    expect(sectionForTarget("Cold-start   LATENCY ranged", sections)).toBe("s2");
  });

  it("locates a paraphrased claim by distinctive-token overlap", () => {
    // Not a substring of any section — must fall to token overlap.
    expect(sectionForTarget("cold-start ranges were never actually measured", sections)).toBe("s2");
    expect(sectionForTarget("who really owns your recordings under the license", sections)).toBe(
      "s3",
    );
  });

  it("falls back to the first section rather than returning nothing", () => {
    expect(sectionForTarget("completely unrelated xyzzy plugh", sections)).toBe("s1");
  });

  it("returns null only when there is no target or no sections", () => {
    expect(sectionForTarget("", sections)).toBeNull();
    expect(sectionForTarget("anything", [])).toBeNull();
  });
});

describe("fillSectionIds", () => {
  const base: Issue = {
    id: "citations:0",
    panel: "geo",
    lever: "citations",
    title: "Uncited claim",
    why: "Ground it.",
    nature: "fix",
    sectionId: "",
    actions: ["cite_source", "highlight"],
    status: "open",
  };

  it("fills a blank sectionId from the target", () => {
    const [out] = fillSectionIds(
      [{ ...base, target: "ownership of your own recordings" }],
      sections,
    );
    expect(out.sectionId).toBe("s3");
  });

  it("leaves a present sectionId untouched", () => {
    const [out] = fillSectionIds([{ ...base, sectionId: "s2", target: "anything" }], sections);
    expect(out.sectionId).toBe("s2");
  });

  it("leaves a targetless issue's sectionId blank", () => {
    const [out] = fillSectionIds([{ ...base, target: undefined }], sections);
    expect(out.sectionId).toBe("");
  });
});
