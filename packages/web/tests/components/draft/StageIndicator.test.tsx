import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StageIndicator } from "../../../src/components/draft/StageIndicator";

describe("StageIndicator", () => {
  it("renders all three stages", () => {
    render(<StageIndicator current="idea" onGoTo={vi.fn()} />);
    // Visible numerals + labels
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    // Each button exposes an accessible "N. Label" name via sr-only text.
    expect(screen.getByRole("button", { name: /1\.\s*Idea/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\.\s*Outline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3\.\s*Sections/i })).toBeInTheDocument();
  });

  it("active stage is marked aria-current=step", () => {
    render(<StageIndicator current="outline" onGoTo={vi.fn()} />);
    const outlineBtn = screen.getByRole("button", { name: /2\.\s*Outline/i });
    expect(outlineBtn).toHaveAttribute("aria-current", "step");
    expect(outlineBtn).toHaveAttribute("data-active", "true");
  });

  it("past stages are clickable", () => {
    const onGoTo = vi.fn();
    render(<StageIndicator current="outline" onGoTo={onGoTo} />);
    fireEvent.click(screen.getByRole("button", { name: /1\.\s*Idea/i }));
    expect(onGoTo).toHaveBeenCalledWith("idea");
  });

  it("future stages are disabled", () => {
    render(<StageIndicator current="idea" onGoTo={vi.fn()} />);
    expect(screen.getByRole("button", { name: /3\.\s*Sections/i })).toBeDisabled();
  });
});
