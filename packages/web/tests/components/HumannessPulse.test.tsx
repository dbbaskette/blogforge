import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HumannessPulse } from "../../src/components/draft/HumannessPulse";

describe("HumannessPulse", () => {
  it("shows the blended humanness number", () => {
    render(<HumannessPulse antiRobot={80} humanSignal={60} />);
    expect(screen.getByText("70")).toBeInTheDocument(); // 0.5*80 + 0.5*60
  });
  it("shows the anti-robot score alone before Humanize has run", () => {
    render(<HumannessPulse antiRobot={82} humanSignal={null} />);
    expect(screen.getByText("82")).toBeInTheDocument();
  });
  it("renders the pulse svg path", () => {
    const { container } = render(<HumannessPulse antiRobot={80} humanSignal={90} />);
    expect(container.querySelector("path")).toBeTruthy();
  });
});
