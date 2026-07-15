import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/drafts", () => ({ inlineEdit: vi.fn() }));

import { inlineEdit } from "../../../src/api/drafts";
import { makeShapeApply } from "../../../src/lib/issues/shapeApply";
import type { Issue } from "../../../src/lib/issues/types";

const draft = {
  id: "d1",
  sections: [{ id: "s1", content_md: "Intro. The wordy bit stays. Outro." }],
} as never;

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "shape:reword:1",
  panel: "shape",
  lever: "reword",
  title: "Tighten",
  why: "",
  nature: "fix",
  sectionId: "",
  target: "The wordy bit stays.",
  fixKind: "reword",
  actions: ["choose_option"],
  status: "open",
  ...over,
});

describe("makeShapeApply — reword", () => {
  it("splices the chosen option over the target and persists", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeShapeApply({ draft, onSectionSave });
    const res = await apply(issue(), "choose_option", "It stays.");
    expect(res?.sectionId).toBe("s1");
    expect(res?.before).toBe("Intro. The wordy bit stays. Outro.");
    expect(res?.after).toBe("Intro. It stays. Outro.");
    expect(onSectionSave).toHaveBeenCalledWith("s1", "Intro. It stays. Outro.", true);
  });
  it("computes without saving when persist is false", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeShapeApply({ draft, onSectionSave });
    const res = await apply(issue(), "choose_option", "It stays.", { persist: false });
    expect(res?.after).toBe("Intro. It stays. Outro.");
    expect(onSectionSave).not.toHaveBeenCalled();
  });
  it("throws a readable error when the target is gone", async () => {
    const apply = makeShapeApply({ draft, onSectionSave: vi.fn() });
    await expect(apply(issue({ target: "not present" }), "choose_option", "x")).rejects.toThrow(
      /couldn't find/i,
    );
  });
  it("no-ops without a chosen option", async () => {
    const apply = makeShapeApply({ draft, onSectionSave: vi.fn() });
    expect(await apply(issue(), "choose_option", undefined)).toBeNull();
  });
});

describe("makeShapeApply — expand", () => {
  it("routes the chosen idea through inlineEdit and splices the result", async () => {
    vi.mocked(inlineEdit).mockResolvedValue({ text: "The wordy bit stays, with a stat." } as never);
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeShapeApply({ draft, onSectionSave });
    const res = await apply(
      issue({ lever: "expand", fixKind: "expand", nature: "add" }),
      "choose_option",
      "Add a stat",
    );
    expect(inlineEdit).toHaveBeenCalledWith("d1", {
      text: "The wordy bit stays.",
      action: "expand",
      instruction: "Add a stat",
    });
    expect(res?.after).toContain("with a stat");
  });
});
