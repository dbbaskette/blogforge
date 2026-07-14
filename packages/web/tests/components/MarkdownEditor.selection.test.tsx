import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiSelectionToolbar } from "../../src/components/draft/MarkdownEditor";

describe("AiSelectionToolbar positioning", () => {
  // Regression: the bar is `position: fixed` with viewport coords, but the
  // editor lives inside a section whose entrance animation leaves a persistent
  // `transform`. A transformed ancestor becomes the containing block for fixed
  // descendants, so an in-tree bar renders off-screen. It must portal to
  // <body> to escape every transformed ancestor.
  it("portals out of a transformed ancestor to document.body", () => {
    render(
      <div data-testid="animated-section" style={{ transform: "matrix(1,0,0,1,0,0)" }}>
        <AiSelectionToolbar anchor={{ top: 300, left: 400 }} busy={false} onAction={() => {}} />
      </div>,
    );

    const toolbar = screen.getByRole("toolbar", { name: "AI editing actions" });
    const section = screen.getByTestId("animated-section");

    // Not trapped inside the transformed section…
    expect(section.contains(toolbar)).toBe(false);
    // …hoisted directly under <body> so `fixed` means the viewport.
    expect(toolbar.parentElement).toBe(document.body);
  });

  it("anchors just above the selection via inline fixed coords", () => {
    render(
      <AiSelectionToolbar anchor={{ top: 306, left: 729 }} busy={false} onAction={() => {}} />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "AI editing actions" });
    expect(toolbar).toHaveClass("fixed");
    // 8px above the selection top; horizontally centered on it via -translate-x-1/2.
    expect(toolbar.style.top).toBe("298px");
    expect(toolbar.style.left).toBe("729px");
    expect(toolbar).toHaveClass("-translate-x-1/2", "-translate-y-full");
  });

  it("fires the chosen action and disables buttons while busy", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <AiSelectionToolbar anchor={{ top: 100, left: 100 }} busy={false} onAction={onAction} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rephrase" }));
    expect(onAction).toHaveBeenCalledWith("rephrase");

    rerender(<AiSelectionToolbar anchor={{ top: 100, left: 100 }} busy onAction={onAction} />);
    expect(screen.getByRole("button", { name: "Rephrase" })).toBeDisabled();
  });
});
