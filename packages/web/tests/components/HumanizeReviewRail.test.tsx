import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HumanizeReport } from "../../src/api/humanize";
import { HumanizeReviewRail } from "../../src/components/draft/HumanizeReviewRail";

const report: HumanizeReport = {
  intensity: "medium",
  score: 88,
  lenses: [
    {
      key: "soul",
      label: "De-robot / Soul",
      findings: [
        {
          lens: "soul",
          section_id: "s1",
          target: "The API serves as a gateway.",
          suggestion: "The API is the gateway.",
          note: "puffery",
          needs_review: false,
        },
      ],
    },
  ],
};

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
const draft: any = {
  id: "d1",
  sections: [{ id: "s1", title: "S", content_md: "The API serves as a gateway." }],
  outline: { opening_hook: "", sections: [] },
};

describe("HumanizeReviewRail", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders lens groups and findings", () => {
    render(
      <HumanizeReviewRail
        report={report}
        draft={draft}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onHighlight={vi.fn()}
      />,
    );
    expect(screen.getByText("De-robot / Soul")).toBeInTheDocument();
    expect(screen.getAllByText(/puffery/i).length).toBeGreaterThan(0);
  });

  it("AI fix opens the preview modal; Apply applies the precomputed suggestion", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    render(<HumanizeReviewRail report={report} draft={draft} onSectionSave={onSectionSave} />);
    fireEvent.click(screen.getByRole("button", { name: "AI fix" }));
    const dialog = await screen.findByRole("dialog");
    expect(onSectionSave).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onSectionSave).toHaveBeenCalledWith("s1", "The API is the gateway.", true),
    );
  });

  it("dismissing a finding persists it and removes the card", () => {
    render(<HumanizeReviewRail report={report} draft={draft} onSectionSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/puffery/i)).not.toBeInTheDocument();
  });

  it("shows a clean message when there are no findings", () => {
    render(
      <HumanizeReviewRail
        report={{ intensity: "medium", score: 100, lenses: [] }}
        draft={draft}
        onSectionSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/reads human/i)).toBeInTheDocument();
  });
});
