import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StageIndicator } from "../../../src/components/draft/StageIndicator";

describe("StageIndicator", () => {
  it("renders all three stages", () => {
    render(<StageIndicator current="idea" onGoTo={vi.fn()} />);
    expect(screen.getByText("1. Idea")).toBeInTheDocument();
    expect(screen.getByText("2. Outline")).toBeInTheDocument();
    expect(screen.getByText("3. Sections")).toBeInTheDocument();
  });

  it("active stage has emerald background", () => {
    render(<StageIndicator current="outline" onGoTo={vi.fn()} />);
    const outlineBtn = screen.getByText("2. Outline");
    expect(outlineBtn.className).toMatch(/emerald/);
  });

  it("past stages are clickable", () => {
    const onGoTo = vi.fn();
    render(<StageIndicator current="outline" onGoTo={onGoTo} />);
    const ideaBtn = screen.getByText("1. Idea");
    ideaBtn.click();
    expect(onGoTo).toHaveBeenCalledWith("idea");
  });

  it("future stages are disabled", () => {
    render(<StageIndicator current="idea" onGoTo={vi.fn()} />);
    const sectionsBtn = screen.getByText("3. Sections");
    expect(sectionsBtn).toBeDisabled();
  });
});
