import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Applied, useIssueLifecycle } from "../../../src/components/review/useIssueLifecycle";
import type { Issue } from "../../../src/lib/issues/types";

const issue: Issue = {
  id: "i1",
  panel: "geo",
  lever: "answer_first",
  title: "Buries its answer",
  why: "Lead with the takeaway.",
  nature: "fix",
  sectionId: "s1",
  target: "Old text.",
  actions: ["ai_fix", "manual_fix", "highlight"],
  status: "open",
};

describe("useIssueLifecycle", () => {
  beforeEach(() => localStorage.clear());

  const setup = (overrides: Partial<Parameters<typeof useIssueLifecycle>[0]> = {}) => {
    const apply = vi.fn(
      async (): Promise<Applied> => ({ sectionId: "s1", before: "Old text.", after: "New text." }),
    );
    const save = vi.fn();
    const onHighlight = vi.fn();
    const onRescore = vi.fn();
    const hook = renderHook(() =>
      useIssueLifecycle({ draftId: "d1", apply, save, onHighlight, onRescore, ...overrides }),
    );
    return { hook, apply, save, onHighlight, onRescore };
  };

  it("apply moves the issue to review, highlights, and rescores", async () => {
    const { hook, apply, onHighlight, onRescore } = setup();
    await act(async () => {
      await hook.result.current.run(issue, "ai_fix");
    });
    expect(apply).toHaveBeenCalledWith(issue, "ai_fix", undefined);
    expect(hook.result.current.statusOf(issue)).toBe("review");
    expect(onHighlight).toHaveBeenCalledWith("s1", "New text.", "under-review");
    expect(onRescore).toHaveBeenCalledWith("answer_first");
  });

  it("accept turns it green and clears the highlight", async () => {
    const { hook, onHighlight } = setup();
    await act(async () => {
      await hook.result.current.run(issue, "ai_fix");
    });
    act(() => hook.result.current.accept(issue));
    expect(hook.result.current.statusOf(issue)).toBe("accepted");
    expect(onHighlight).toHaveBeenLastCalledWith("s1", null, "under-review");
  });

  it("undo restores the original content, rescores, and reopens", async () => {
    const { hook, save, onRescore } = setup();
    await act(async () => {
      await hook.result.current.run(issue, "ai_fix");
    });
    await act(async () => {
      await hook.result.current.undo(issue);
    });
    expect(save).toHaveBeenCalledWith("s1", "Old text.", "content");
    expect(onRescore).toHaveBeenCalledWith("answer_first");
    expect(hook.result.current.statusOf(issue)).toBe("open");
  });

  it("highlight action locates without changing status", async () => {
    const { hook, apply, onHighlight } = setup();
    await act(async () => {
      await hook.result.current.run(issue, "highlight");
    });
    expect(apply).not.toHaveBeenCalled();
    expect(onHighlight).toHaveBeenCalledWith("s1", "Old text.", "locate");
    expect(hook.result.current.statusOf(issue)).toBe("open");
  });

  it("dismiss goes straight to accepted", async () => {
    const advisory: Issue = { ...issue, nature: "advisory", actions: ["dismiss"] };
    const { hook } = setup({
      apply: async () => ({ sectionId: "s1", before: "x", after: "x" }),
    });
    await act(async () => {
      await hook.result.current.run(advisory, "dismiss");
    });
    expect(hook.result.current.statusOf(advisory)).toBe("accepted");
  });

  // Persistence: a fix/dismissal must survive closing and reopening the panel —
  // the whole point of "corrections should be persistent". A fresh hook (new
  // mount, same draftId) hydrates the last-known status from localStorage.
  it("persists a dismissal and rehydrates it on a fresh mount", async () => {
    const advisory: Issue = { ...issue, nature: "advisory", actions: ["dismiss"] };
    const first = setup();
    await act(async () => {
      await first.hook.result.current.run(advisory, "dismiss");
    });
    expect(first.hook.result.current.statusOf(advisory)).toBe("accepted");

    // Reopen: a brand-new hook instance for the same draft.
    const second = setup();
    expect(second.hook.result.current.statusOf(advisory)).toBe("accepted");
  });

  it("persists an accepted fix across a remount", async () => {
    const first = setup();
    await act(async () => {
      await first.hook.result.current.run(issue, "ai_fix");
    });
    act(() => first.hook.result.current.accept(issue));

    const second = setup();
    expect(second.hook.result.current.statusOf(issue)).toBe("accepted");
  });

  it("undo removes the persisted status so a reopened panel shows it open again", async () => {
    const first = setup();
    await act(async () => {
      await first.hook.result.current.run(issue, "ai_fix");
    });
    await act(async () => {
      await first.hook.result.current.undo(issue);
    });
    const second = setup();
    expect(second.hook.result.current.statusOf(issue)).toBe("open");
  });

  it("scopes persisted status by draft — another draft is unaffected", async () => {
    const first = setup();
    await act(async () => {
      await first.hook.result.current.run(issue, "ai_fix");
    });
    act(() => first.hook.result.current.accept(issue));

    const other = setup({ draftId: "d2" });
    expect(other.hook.result.current.statusOf(issue)).toBe("open");
  });
});
