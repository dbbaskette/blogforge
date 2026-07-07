import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/humanize", () => ({
  analyzeHumanize: vi.fn().mockResolvedValue({
    intensity: "medium",
    score: 90,
    lenses: [{ key: "flow", label: "Flow & Rhythm", findings: [] }],
  }),
}));

import { analyzeHumanize } from "../../src/api/humanize";
import { HumanizePanel } from "../../src/components/draft/HumanizePanel";
import { hashDraftContent, setCached } from "../../src/lib/panelCache";

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
const draft: any = {
  id: "d1",
  title: "T",
  sections: [{ id: "s1", title: "S", content_md: "x" }],
  outline: { opening_hook: "h" },
};

describe("HumanizePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("runs the pass on open and shows the intensity dial", async () => {
    render(<HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "medium"));
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /strong/i })).toBeInTheDocument();
  });

  it("renders the mark + dial head icons instead of the old ring", async () => {
    render(<HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalled());
    const images = screen.getAllByRole("img") as HTMLImageElement[];
    const srcs = images.map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/humanize/mark.png");
    expect(srcs).toContain("/humanize/robot.png");
    expect(srcs).toContain("/humanize/half.png");
    expect(srcs).toContain("/humanize/human.png");
  });

  it("shows the HumannessPulse readout once the report loads", async () => {
    render(<HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("reads human")).toBeInTheDocument());
  });

  it("switching intensity re-runs the pass and persists the choice", async () => {
    render(<HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "medium"));

    fireEvent.click(screen.getByRole("button", { name: /strong/i }));
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "strong"));
    expect(localStorage.getItem("bf.humanize.intensity.d1")).toBe("strong");
  });

  it("skips re-analyzing when a cached report exists for the current content + intensity", async () => {
    const hash = hashDraftContent(draft);
    const cached = {
      intensity: "medium" as const,
      score: 77,
      lenses: [{ key: "soul", label: "De-robot / Soul", findings: [] }],
    };
    setCached("humanize", draft.id, `${hash}:medium`, cached);

    render(<HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    // Cached report renders — the radar's "soul" axis label shows up, replacing
    // the old plain-text lens-coverage strip...
    await waitFor(() => expect(screen.getByText("soul")).toBeInTheDocument());
    // ...without ever calling analyzeHumanize.
    expect(analyzeHumanize).not.toHaveBeenCalled();
  });

  it("shows the radar and heat-maps a flagged finding in the read pane", async () => {
    (analyzeHumanize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      intensity: "medium",
      score: 85,
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
    });
    // biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
    const d: any = {
      id: "d1",
      title: "T",
      outline: { opening_hook: "h" },
      sections: [{ id: "s1", title: "S", content_md: "The API serves as a gateway. It adds 5ms." }],
    };
    render(<HumanizePanel draft={d} onSectionSave={vi.fn()} onClose={vi.fn()} />);
    // radar axis label — always rendered, engaged or not
    await waitFor(() => expect(screen.getByText("flow")).toBeInTheDocument());
    // the flagged sentence is heat-mapped in the read pane
    await waitFor(() =>
      expect(screen.getAllByText(/serves as a gateway/i).length).toBeGreaterThan(0),
    );
  });
});
