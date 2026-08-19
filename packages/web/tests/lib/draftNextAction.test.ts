import { describe, expect, it } from "vitest";

import { type DraftNextActionState, deriveNextDraftAction } from "../../src/lib/draftNextAction";

const readyResearch: DraftNextActionState = {
  stage: "research",
  hasModel: true,
  outlineCount: 0,
  unwrittenCount: 0,
  totalSections: 0,
  generationRunning: false,
  generationFailed: false,
  outlineDrift: false,
};

describe("deriveNextDraftAction", () => {
  it.each([
    {
      name: "new research",
      state: {},
      want: { kind: "create-outline", label: "Create outline", disabled: false },
    },
    {
      name: "research blocked by missing model",
      state: { hasModel: false },
      want: {
        kind: "create-outline",
        label: "Create outline",
        disabled: true,
        blocker: "setup",
      },
    },
    {
      name: "outline with sections",
      state: { stage: "outline", outlineCount: 4 },
      want: { kind: "compose-draft", label: "Compose draft", disabled: false },
    },
    {
      name: "outline blocked by no sections",
      state: { stage: "outline" },
      want: {
        kind: "compose-draft",
        label: "Compose draft",
        disabled: true,
        blocker: "outline",
      },
    },
    {
      name: "active generation",
      state: {
        stage: "sections",
        outlineCount: 4,
        unwrittenCount: 3,
        totalSections: 4,
        generationRunning: true,
      },
      want: { kind: "compose-draft", label: "Writing draft", disabled: true },
    },
    {
      name: "partial draft",
      state: {
        stage: "sections",
        outlineCount: 4,
        unwrittenCount: 2,
        totalSections: 4,
      },
      want: {
        kind: "finish-remaining",
        label: "Finish remaining sections",
        disabled: false,
      },
    },
    {
      name: "failed generation with unwritten sections",
      state: {
        stage: "sections",
        outlineCount: 4,
        unwrittenCount: 2,
        totalSections: 4,
        generationFailed: true,
      },
      want: {
        kind: "retry-remaining",
        label: "Retry remaining sections",
        disabled: false,
      },
    },
    {
      name: "complete current draft",
      state: { stage: "sections", outlineCount: 4, totalSections: 4 },
      want: { kind: "review-draft", label: "Review draft", disabled: false },
    },
    {
      name: "complete draft with stale outline",
      state: {
        stage: "sections",
        outlineCount: 4,
        totalSections: 4,
        outlineDrift: true,
      },
      want: { kind: "review-outline", label: "Review outline", disabled: false },
    },
  ])("derives the next action for $name", ({ state, want }) => {
    expect(
      deriveNextDraftAction({ ...readyResearch, ...(state as Partial<DraftNextActionState>) }),
    ).toMatchObject(want);
  });

  it("reports saved progress while generation is active", () => {
    const action = deriveNextDraftAction({
      ...readyResearch,
      stage: "sections",
      outlineCount: 5,
      totalSections: 5,
      unwrittenCount: 3,
      generationRunning: true,
    });

    expect(action.copy).toContain("2 of 5 sections written");
  });
});
