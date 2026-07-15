import { describe, expect, it } from "vitest";
import { issueId, makeIdFactory } from "../../../src/lib/issues/issueIds";

describe("issueId", () => {
  it("is stable for the same content regardless of position", () => {
    const a = issueId("geo", "answer_first", { sectionId: "s1", target: "hello", title: "Buried" });
    const b = issueId("geo", "answer_first", { sectionId: "s1", target: "hello", title: "Buried" });
    expect(a).toBe(b);
  });
  it("differs when content differs", () => {
    const a = issueId("geo", "answer_first", { sectionId: "s1", target: "hello", title: "Buried" });
    const b = issueId("geo", "answer_first", { sectionId: "s1", target: "world", title: "Buried" });
    expect(a).not.toBe(b);
  });
  it("namespaces by panel and lever", () => {
    expect(issueId("geo", "answer_first", { title: "x" })).toMatch(/^geo:answer_first:/);
    expect(issueId("humanize", "cadence", { title: "x" })).toMatch(/^humanize:cadence:/);
  });
});

describe("makeIdFactory", () => {
  it("disambiguates collisions within one report", () => {
    const next = makeIdFactory();
    const parts = { sectionId: "s1", target: "same", title: "same" };
    const a = next("geo", "lever", parts);
    const b = next("geo", "lever", parts);
    expect(a).not.toBe(b);
    expect(b).toBe(`${a}#1`);
  });
});
