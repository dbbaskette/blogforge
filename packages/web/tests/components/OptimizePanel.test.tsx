import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/geo", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/geo")>("../../src/api/geo");
  return {
    ...actual,
    analyzeGeo: vi.fn(),
    rescoreGeo: vi.fn(),
    generateFaq: vi.fn(),
    generateOpener: vi.fn(),
    generateTable: vi.fn(),
    generateTakeaways: vi.fn(),
    geoCite: vi.fn(),
    geoQuotes: vi.fn(),
  };
});
vi.mock("../../src/api/drafts", () => ({
  inlineEdit: vi.fn().mockResolvedValue({ text: "Rewritten." }),
}));
vi.mock("../../src/api/references", () => ({ listReferences: vi.fn().mockResolvedValue([]) }));

import { type GeoReport, analyzeGeo } from "../../src/api/geo";
import { OptimizePanel } from "../../src/components/draft/OptimizePanel";

const report: GeoReport = {
  score: 62,
  grade: "C",
  levers: [
    {
      key: "answer_first",
      label: "Answer-first sections",
      score: 55,
      detail: "Lead with the takeaway.",
      fix: null,
      findings: [
        {
          section_id: "s1",
          target: "There are a few things worth considering first.",
          note: "This section buries its answer",
          fix: "answer_first",
        },
      ],
    },
  ],
};

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub for the panel
const draft: any = {
  id: "d1",
  title: "My Great Post",
  stage: "sections",
  sections: [
    {
      id: "s1",
      title: "First Section",
      content_md: "There are a few things worth considering first. Then the point.",
    },
  ],
  outline: { opening_hook: "An opening lede sentence.", sections: [] },
};

describe("OptimizePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(analyzeGeo).mockResolvedValue(report);
  });

  it("analyzes on mount and renders the score header, a section preview, and the rail", async () => {
    render(
      <OptimizePanel
        draft={draft}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    // Analyze fires on mount.
    await waitFor(() => expect(analyzeGeo).toHaveBeenCalledWith("d1"));

    // Score header: the overall score + grade chip appears once the report loads.
    await waitFor(() => expect(screen.getByText("62")).toBeInTheDocument());
    expect(screen.getByText("C")).toBeInTheDocument();

    // Left pane preview: the title, opening lede, and section prose.
    expect(screen.getByText("My Great Post")).toBeInTheDocument();
    expect(screen.getByText("An opening lede sentence.")).toBeInTheDocument();
    expect(screen.getByText("First Section")).toBeInTheDocument();

    // Right pane rail: the lever heading and its finding card.
    expect(screen.getByText("Answer-first sections")).toBeInTheDocument();
    expect(screen.getByText("This section buries its answer")).toBeInTheDocument();
  });

  it("shows a scoring state while analyze is in flight", () => {
    vi.mocked(analyzeGeo).mockReturnValue(new Promise(() => {}));
    render(
      <OptimizePanel
        draft={draft}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Scoring your draft…")).toBeInTheDocument();
  });
});
