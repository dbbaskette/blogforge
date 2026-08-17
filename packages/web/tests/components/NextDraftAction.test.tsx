import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NextDraftAction } from "../../src/components/draft/NextDraftAction";
import type { DraftNextAction } from "../../src/lib/draftNextAction";

const createOutline: DraftNextAction = {
  kind: "create-outline",
  label: "Create outline",
  copy: "Turn your research into an editable section plan.",
  disabled: false,
};

describe("NextDraftAction", () => {
  it("renders one strong action and calls the matching callback", async () => {
    const onCreateOutline = vi.fn();
    const { container } = render(
      <NextDraftAction action={createOutline} onCreateOutline={onCreateOutline} />,
    );

    expect(screen.getByText("NEXT")).toBeInTheDocument();
    expect(container.querySelectorAll(".nb-btn-primary")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Create outline" }));
    await waitFor(() => expect(onCreateOutline).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create outline" })).toBeEnabled(),
    );
  });

  it("keeps a blocked action disabled and directs the writer to Setup", () => {
    const onSetup = vi.fn();
    render(
      <NextDraftAction
        action={{
          ...createOutline,
          copy: "Choose a model in Setup before creating an outline.",
          disabled: true,
          blocker: "setup",
        }}
        onSetup={onSetup}
      />,
    );

    expect(screen.getByRole("button", { name: "Create outline" })).toBeDisabled();
    fireEvent.click(screen.getByRole("link", { name: "Open Setup" }));
    expect(onSetup).toHaveBeenCalledOnce();
  });

  it.each([
    ["compose-draft", "Compose draft", "onComposeDraft"],
    ["retry-remaining", "Retry remaining sections", "onRetryRemaining"],
    ["finish-remaining", "Finish remaining sections", "onFinishRemaining"],
    ["review-outline", "Review outline", "onReviewOutline"],
    ["review-draft", "Review draft", "onReviewDraft"],
  ] as const)("routes %s to its workspace callback", async (kind, label, callbackName) => {
    const callback = vi.fn();
    render(
      <NextDraftAction
        action={{ kind, label, copy: "Continue with the draft.", disabled: false }}
        {...{ [callbackName]: callback }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(callback).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: label })).toBeEnabled());
  });

  it("catches a rejected action, prevents double clicks, and offers recovery", async () => {
    const onComposeDraft = vi.fn().mockRejectedValue(new Error("Request failed before streaming"));
    render(
      <NextDraftAction
        action={{
          kind: "compose-draft",
          label: "Compose draft",
          copy: "The outline is ready for prose.",
          disabled: false,
        }}
        onComposeDraft={onComposeDraft}
      />,
    );

    const compose = screen.getByRole("button", { name: "Compose draft" });
    fireEvent.click(compose);
    fireEvent.click(compose);

    expect(onComposeDraft).toHaveBeenCalledOnce();
    expect(compose).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    await waitFor(() => expect(compose).toBeEnabled());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
