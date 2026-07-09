import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", () => ({
  inlineEdit: vi.fn().mockResolvedValue({ text: "A direct answer up front. Then detail." }),
}));
vi.mock("../../src/api/geo", () => ({
  generateFaq: vi.fn(),
  generateOpener: vi.fn(),
  generateTable: vi.fn(),
  generateTakeaways: vi.fn(),
  geoCite: vi.fn(),
  geoQuotes: vi.fn(),
}));
vi.mock("../../src/api/references", () => ({ listReferences: vi.fn().mockResolvedValue([]) }));

import { inlineEdit } from "../../src/api/drafts";
import type { GeoReport } from "../../src/api/geo";
import { GeoReviewRail } from "../../src/components/draft/GeoReviewRail";

const report: GeoReport = {
  score: 62,
  grade: "C",
  levers: [
    {
      key: "answer_first",
      label: "Answer-first sections",
      score: 55,
      weight: 0.13,
      detail: "Lead with the takeaway.",
      impact: "Engines lift the first sentence into their answer.",
      fix: null,
      findings: [
        {
          section_id: "s1",
          target: "There are a few things worth considering first.",
          note: "This section buries its answer",
          fix: "answer_first",
          impact: "Engines lift the first sentence into their answer.",
        },
      ],
    },
  ],
};

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub for the rail
const draft: any = {
  id: "d1",
  sections: [
    { id: "s1", content_md: "There are a few things worth considering first. Then the point." },
  ],
  outline: { opening_hook: "", sections: [] },
};

describe("GeoReviewRail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a card per finding under its lever", () => {
    render(
      <GeoReviewRail
        report={report}
        draft={draft}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onTitleSave={vi.fn().mockResolvedValue(undefined)}
        onOpeningSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText("Answer-first sections")).toBeInTheDocument();
    expect(screen.getByText("This section buries its answer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI fix" })).toBeInTheDocument();
  });

  it("AI fix opens the preview modal; Apply drives the api and saves", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GeoReviewRail
        report={report}
        draft={draft}
        onSectionSave={onSectionSave}
        onTitleSave={vi.fn().mockResolvedValue(undefined)}
        onOpeningSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI fix" }));
    // The rewrite is computed for the preview, but nothing is saved yet.
    await waitFor(() => expect(inlineEdit).toHaveBeenCalled());
    const dialog = await screen.findByRole("dialog");
    expect(onSectionSave).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    // The mocked inlineEdit rewrite ("A direct answer up front. Then detail.")
    // is spliced in for the target sentence, and makeGeoSave persists the whole
    // section body via onSectionSave.
    await waitFor(() =>
      expect(onSectionSave).toHaveBeenCalledWith(
        "s1",
        "A direct answer up front. Then detail. Then the point.",
      ),
    );
  });

  it("shows the impact line on a finding card and the point stakes on the lever header", () => {
    // A distinct draft id keeps this render's lifecycle status (persisted to
    // localStorage, keyed by draftId) isolated from the accept/undo flow the
    // previous test already ran against "d1".
    render(
      <GeoReviewRail
        report={report}
        draft={{ ...draft, id: "d-impact" }}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onTitleSave={vi.fn().mockResolvedValue(undefined)}
        onOpeningSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText(/up to 13 pts/i)).toBeInTheDocument();
    expect(screen.getByText(/GEO: Engines lift/)).toBeInTheDocument();
  });
});
