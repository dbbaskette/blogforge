import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HumanizationCheck } from "../../src/components/draft/HumanizationCheck";

describe("HumanizationCheck", () => {
  it("reports a clean completed check without an authorship percentage", () => {
    render(
      <HumanizationCheck
        voiceRules={{ status: "complete", count: 0 }}
        humanize={{ status: "complete", count: 0 }}
        lensCount={3}
      />,
    );

    expect(screen.getByText("Looks natural")).toBeInTheDocument();
    expect(screen.getByText("No voice-rule issues")).toBeInTheDocument();
    expect(screen.getByText("No suggestions across 3 lenses")).toBeInTheDocument();
    expect(screen.queryByText(/reads human/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("prioritizes deterministic voice-rule findings", () => {
    render(
      <HumanizationCheck
        voiceRules={{ status: "complete", count: 2 }}
        humanize={{ status: "complete", count: 3 }}
        lensCount={3}
      />,
    );

    expect(screen.getByText("Voice rules need attention")).toBeInTheDocument();
    expect(screen.getByText("2 open findings")).toBeInTheDocument();
    expect(screen.getByText("3 suggestions across 3 lenses")).toBeInTheDocument();
  });

  it("reports advisory suggestions after voice rules are clean", () => {
    render(
      <HumanizationCheck
        voiceRules={{ status: "complete", count: 0 }}
        humanize={{ status: "complete", count: 1 }}
        lensCount={2}
      />,
    );

    expect(screen.getByText("Review Humanize suggestions")).toBeInTheDocument();
    expect(screen.getByText("1 suggestion across 2 lenses")).toBeInTheDocument();
  });

  it("shows pending copy without substituting a score", () => {
    render(
      <HumanizationCheck
        voiceRules={{ status: "pending" }}
        humanize={{ status: "pending" }}
        lensCount={4}
      />,
    );

    expect(screen.getByText("Checking humanization…")).toBeInTheDocument();
    expect(screen.getByText("Checking voice rules…")).toBeInTheDocument();
    expect(screen.getByText("Analyzing 4 lenses…")).toBeInTheDocument();
  });

  it("shows unavailable checks as incomplete", () => {
    render(
      <HumanizationCheck
        voiceRules={{ status: "unavailable" }}
        humanize={{ status: "unavailable" }}
        lensCount={3}
      />,
    );

    expect(screen.getByText("Check incomplete")).toBeInTheDocument();
    expect(screen.getByText("Voice-rule check unavailable")).toBeInTheDocument();
    expect(screen.getByText("Humanize review unavailable")).toBeInTheDocument();
  });

  it("singularizes one open voice-rule finding", () => {
    render(
      <HumanizationCheck
        voiceRules={{ status: "complete", count: 1 }}
        humanize={{ status: "complete", count: 0 }}
        lensCount={3}
      />,
    );

    expect(screen.getByText("1 open finding")).toBeInTheDocument();
  });
});
