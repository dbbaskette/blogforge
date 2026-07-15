import { beforeEach, describe, expect, it } from "vitest";
import { dismiss, loadDismissed, restore } from "../../../src/lib/issues/dismissals";

beforeEach(() => localStorage.clear());

describe("dismissals", () => {
  it("starts empty", () => {
    expect(loadDismissed("d1").size).toBe(0);
  });
  it("round-trips a dismissal", () => {
    dismiss("d1", "geo:citations:abc");
    expect(loadDismissed("d1").has("geo:citations:abc")).toBe(true);
  });
  it("restores a dismissal", () => {
    dismiss("d1", "geo:citations:abc");
    restore("d1", "geo:citations:abc");
    expect(loadDismissed("d1").has("geo:citations:abc")).toBe(false);
  });
  it("keeps drafts isolated", () => {
    dismiss("d1", "x");
    expect(loadDismissed("d2").size).toBe(0);
  });
  it("holds ids from every panel in one store", () => {
    dismiss("d1", "geo:a:1");
    dismiss("d1", "humanize:b:2");
    dismiss("d1", "pf:c:3");
    dismiss("d1", "shape:d:4");
    expect(loadDismissed("d1").size).toBe(4);
  });
  it("survives malformed storage", () => {
    localStorage.setItem("bf.review.dismissed.d1", "{not json");
    expect(loadDismissed("d1").size).toBe(0);
  });
});
