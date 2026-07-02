import { beforeEach, describe, expect, it } from "vitest";

import {
  approveAll,
  approveChange,
  loadPending,
  pendingTextsFor,
  prunePending,
  trackChange,
} from "../../src/lib/trackedChanges";

beforeEach(() => localStorage.clear());

describe("trackedChanges", () => {
  it("records only the added runs of an edit", () => {
    trackChange("d1", "s1", "the cat sat", "the happy cat sat", "geo:bullets");
    const p = loadPending("d1");
    expect(p.map((c) => c.text.trim())).toEqual(["happy"]);
    expect(p[0].sectionId).toBe("s1");
    expect(p[0].source).toBe("geo:bullets");
  });

  it("returns the created ids and approveChange removes exactly those", () => {
    const ids = trackChange("d1", "s1", "a", "a b c", "x"); // adds "b c" (one run)
    trackChange("d1", "s2", "c", "c d", "y");
    approveChange("d1", ids);
    expect(loadPending("d1").map((c) => c.sectionId)).toEqual(["s2"]);
  });

  it("approveAll clears the draft", () => {
    trackChange("d1", "s1", "a", "a b", "x");
    approveAll("d1");
    expect(loadPending("d1")).toEqual([]);
  });

  it("prunePending drops runs no longer present in the section text", () => {
    trackChange("d1", "s1", "a", "a inserted", "x");
    prunePending("d1", [{ id: "s1", content_md: "a" }]); // user deleted "inserted"
    expect(loadPending("d1")).toEqual([]);
  });

  it("pendingTextsFor returns only that section's runs", () => {
    // Mid-string insertion (the common rewrite case) — a clean single added run.
    trackChange("d1", "s1", "keep this here", "keep ONE this here", "x");
    trackChange("d1", "s2", "other words now", "other TWO words now", "y");
    expect(pendingTextsFor("d1", "s1")).toEqual(["ONE"]);
  });

  it("no-throw and returns [] when localStorage write fails", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    expect(() => trackChange("d1", "s1", "a", "a b", "x")).not.toThrow();
    Storage.prototype.setItem = orig;
  });

  it("an edit with no additions records nothing", () => {
    expect(trackChange("d1", "s1", "same text", "same text", "x")).toEqual([]);
    expect(loadPending("d1")).toEqual([]);
  });
});
