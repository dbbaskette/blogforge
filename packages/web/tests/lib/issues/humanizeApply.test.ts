import { describe, expect, it, vi } from "vitest";
import { makeHumanizeApply, makeHumanizeSave } from "../../../src/lib/issues/humanizeApply";
import type { Issue } from "../../../src/lib/issues/types";

const issue = (over: Partial<Issue>): Issue =>
  ({
    id: "h1",
    panel: "humanize",
    lever: "flow",
    title: "t",
    why: "w",
    nature: "fix",
    sectionId: "s1",
    actions: ["ai_fix"],
    status: "open",
    ...over,
  }) as Issue;

describe("makeHumanizeSave", () => {
  it("replaces the target with the suggestion and saves the section", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const draft: any = { sections: [{ id: "s1", content_md: "The API serves as a gateway. It adds 5ms." }] };
    const save = makeHumanizeSave(draft, onSectionSave);
    await save({ sectionId: "s1", target: "The API serves as a gateway.", suggestion: "The API is the gateway." } as any);
    expect(onSectionSave).toHaveBeenCalledWith("s1", "The API is the gateway. It adds 5ms.", true);
  });
});

describe("makeHumanizeApply", () => {
  it("applies a fix whose target has drifted only in whitespace (reflowed text)", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    // Target uses single spaces; the section content has a newline in the run.
    const draft: any = {
      sections: [{ id: "s1", content_md: "Ship it.\nRun it locally, then\npush it up." }],
    };
    const apply = makeHumanizeApply(draft, onSectionSave);
    const res = await apply(
      issue({ target: "Run it locally, then push it up.", suggestion: "Run it locally. Then push it." }),
      "ai_fix",
    );
    expect(res).not.toBeNull();
    expect(onSectionSave).toHaveBeenCalledWith("s1", "Ship it.\nRun it locally. Then push it.", true);
  });

  it("THROWS a clear error (never a silent no-op) when the target is no longer in the section", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    // A stale finding: the model's paraphrased target isn't verbatim in content.
    const draft: any = {
      sections: [{ id: "s1", content_md: "Claude also gives you [Managed Agents](x) that run remotely." }],
    };
    const apply = makeHumanizeApply(draft, onSectionSave);
    await expect(
      apply(
        issue({ target: "Claude also offers Managed Agents that run remotely.", suggestion: "Rewritten." }),
        "ai_fix",
      ),
    ).rejects.toThrow(/re-analyze/i);
    expect(onSectionSave).not.toHaveBeenCalled();
  });

  it("persist:false computes the spliced text but does NOT save", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const draft: any = {
      sections: [{ id: "s1", content_md: "The API serves as a gateway. It adds 5ms." }],
    };
    const apply = makeHumanizeApply(draft, onSectionSave);
    const res = await apply(
      issue({ target: "The API serves as a gateway.", suggestion: "The API is the gateway." }),
      "ai_fix",
      undefined,
      { persist: false },
    );
    expect(onSectionSave).not.toHaveBeenCalled();
    expect(res?.after).toBe("The API is the gateway. It adds 5ms.");
  });

  it("dismiss remains a no-op that does not throw", async () => {
    const draft: any = { sections: [{ id: "s1", content_md: "anything" }] };
    const apply = makeHumanizeApply(draft, vi.fn());
    await expect(apply(issue({ target: "x", suggestion: "y" }), "dismiss")).resolves.toMatchObject({
      sectionId: "s1",
    });
  });
});
