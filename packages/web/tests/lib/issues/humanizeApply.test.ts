import { describe, expect, it, vi } from "vitest";
import { makeHumanizeSave } from "../../../src/lib/issues/humanizeApply";

describe("makeHumanizeSave", () => {
  it("replaces the target with the suggestion and saves the section", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const draft: any = { sections: [{ id: "s1", content_md: "The API serves as a gateway. It adds 5ms." }] };
    const save = makeHumanizeSave(draft, onSectionSave);
    await save({ sectionId: "s1", target: "The API serves as a gateway.", suggestion: "The API is the gateway." } as any);
    expect(onSectionSave).toHaveBeenCalledWith("s1", "The API is the gateway. It adds 5ms.", true);
  });
});
