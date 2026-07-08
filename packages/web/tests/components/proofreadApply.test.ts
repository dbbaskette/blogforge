import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", () => ({
  inlineEdit: vi.fn().mockResolvedValue({ text: "The revised sentence." }),
}));

import { inlineEdit } from "../../src/api/drafts";
import { makeProofreadApply } from "../../src/components/draft/proofreadApply";
import type { Issue } from "../../src/lib/issues/types";

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
const draft: any = {
  id: "d1",
  sections: [{ id: "s1", content_md: "This is very unique wording. And more." }],
};

const issue: Issue = {
  id: "proofread:0",
  panel: "proofread",
  lever: "cliche",
  title: "Overused phrase",
  why: "Freshen it up.",
  nature: "fix",
  sectionId: "s1",
  target: "very unique",
  actions: ["ai_fix", "manual_fix", "highlight"],
  status: "open",
};

describe("makeProofreadApply", () => {
  it("ai_fix rewrites the enclosing sentence via the model and saves", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeProofreadApply({ draft, onSectionSave });
    const res = await apply(issue, "ai_fix");
    expect(inlineEdit).toHaveBeenCalled();
    expect(res?.after).toBe("The revised sentence. And more.");
    expect(onSectionSave).toHaveBeenCalledWith("s1", "The revised sentence. And more.");
  });

  it("persist:false computes the rewrite via the model but does NOT save", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeProofreadApply({ draft, onSectionSave });
    const res = await apply(issue, "ai_fix", undefined, { persist: false });
    expect(inlineEdit).toHaveBeenCalled();
    expect(res?.after).toBe("The revised sentence. And more.");
    expect(onSectionSave).not.toHaveBeenCalled();
  });
});
