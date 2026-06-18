import { beforeEach, describe, expect, it } from "vitest";

import { dismiss, loadDismissed, restore } from "../../src/lib/lintDismissals";

describe("lintDismissals", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadDismissed("d1").size).toBe(0);
  });

  it("dismiss then load round-trips, scoped per draft", () => {
    dismiss("d1", "violation:a:0:x");
    dismiss("d1", "repetition:b:5:y");
    const ids = loadDismissed("d1");
    expect(ids.has("violation:a:0:x")).toBe(true);
    expect(ids.has("repetition:b:5:y")).toBe(true);
    expect(loadDismissed("d2").size).toBe(0); // other drafts unaffected
  });

  it("restore removes a dismissal", () => {
    dismiss("d1", "k1");
    dismiss("d1", "k2");
    restore("d1", "k1");
    const ids = loadDismissed("d1");
    expect(ids.has("k1")).toBe(false);
    expect(ids.has("k2")).toBe(true);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("bf.lint.dismissed.d1", "{not json");
    expect(loadDismissed("d1").size).toBe(0);
  });
});
