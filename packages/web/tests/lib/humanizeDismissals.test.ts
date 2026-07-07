import { beforeEach, describe, expect, it } from "vitest";
import { dismiss, loadDismissed, restore } from "../../src/lib/humanizeDismissals";

describe("humanizeDismissals", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips dismiss/restore per draft", () => {
    expect(loadDismissed("d1").size).toBe(0);
    dismiss("d1", "issue-a");
    expect(loadDismissed("d1").has("issue-a")).toBe(true);
    restore("d1", "issue-a");
    expect(loadDismissed("d1").has("issue-a")).toBe(false);
  });

  it("keys are per-draft", () => {
    dismiss("d1", "x");
    expect(loadDismissed("d2").size).toBe(0);
  });
});
