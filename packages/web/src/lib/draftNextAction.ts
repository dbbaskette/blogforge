import type { DraftStage } from "../api/drafts";

export type DraftNextActionKind =
  | "create-outline"
  | "compose-draft"
  | "retry-remaining"
  | "finish-remaining"
  | "review-outline"
  | "review-draft";

export interface DraftNextActionState {
  stage: DraftStage;
  hasModel: boolean;
  outlineCount: number;
  unwrittenCount: number;
  totalSections: number;
  generationRunning: boolean;
  generationFailed: boolean;
  outlineDrift: boolean;
}

export interface DraftNextAction {
  kind: DraftNextActionKind;
  label: string;
  copy: string;
  disabled: boolean;
  blocker?: "setup" | "outline";
}

export function deriveNextDraftAction(state: DraftNextActionState): DraftNextAction {
  if (state.stage === "research") {
    if (!state.hasModel) {
      return {
        kind: "create-outline",
        label: "Create outline",
        copy: "Choose a model in Setup before creating an outline.",
        disabled: true,
        blocker: "setup",
      };
    }
    return {
      kind: "create-outline",
      label: "Create outline",
      copy: "Turn your research into an editable section plan.",
      disabled: false,
    };
  }

  if (state.stage === "outline") {
    if (state.outlineCount === 0) {
      return {
        kind: "compose-draft",
        label: "Compose draft",
        copy: "Add at least one outline section before composing.",
        disabled: true,
        blocker: "outline",
      };
    }
    return {
      kind: "compose-draft",
      label: "Compose draft",
      copy: `${state.outlineCount} planned section${state.outlineCount === 1 ? " is" : "s are"} ready for prose.`,
      disabled: false,
    };
  }

  if (state.generationRunning) {
    const writtenCount = Math.max(0, state.totalSections - state.unwrittenCount);
    return {
      kind: "compose-draft",
      label: "Writing draft",
      copy: `${writtenCount} of ${state.totalSections} sections written. Completed work is saved as writing continues.`,
      disabled: true,
    };
  }

  if (state.generationFailed && state.unwrittenCount > 0) {
    return {
      kind: "retry-remaining",
      label: "Retry remaining sections",
      copy: `${state.unwrittenCount} section${state.unwrittenCount === 1 ? "" : "s"} still need prose. Completed sections are preserved.`,
      disabled: false,
    };
  }

  if (state.unwrittenCount > 0) {
    return {
      kind: "finish-remaining",
      label: "Finish remaining sections",
      copy: `${state.unwrittenCount} section${state.unwrittenCount === 1 ? "" : "s"} still need prose. Finish them without replacing completed work.`,
      disabled: false,
    };
  }

  if (state.outlineDrift) {
    return {
      kind: "review-outline",
      label: "Review outline",
      copy: "The outline and drafted sections differ. Check the plan before review.",
      disabled: false,
    };
  }

  return {
    kind: "review-draft",
    label: "Review draft",
    copy: "The draft is complete and ready for editorial review.",
    disabled: false,
  };
}
