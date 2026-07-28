import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/humanize", () => ({
  analyzeHumanize: vi.fn().mockResolvedValue({
    intensity: "medium",
    score: 90,
    lenses: [{ key: "flow", label: "Flow & Rhythm", findings: [] }],
  }),
}));

vi.mock("../../src/api/drafts", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/drafts")>("../../src/api/drafts");
  return {
    ...actual,
    lintDraft: vi.fn().mockResolvedValue({ violations: [], repetitions: [], hits: [] }),
  };
});

import { lintDraft } from "../../src/api/drafts";
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
    (lintDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      violations: [],
      repetitions: [],
      hits: [],
    });
    (analyzeHumanize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      intensity: "medium",
      score: 90,
      lenses: [{ key: "flow", label: "Flow & Rhythm", findings: [] }],
    });
  });

  it("runs the pass on open and shows the intensity dial", async () => {
    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "medium"));
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /strong/i })).toBeInTheDocument();
  });

  it("renders the mark + dial head icons instead of the old ring", async () => {
    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalled());
    const images = screen.getAllByRole("img") as HTMLImageElement[];
    const srcs = images.map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/humanize/mark.png");
    expect(srcs).toContain("/humanize/robot.png");
    expect(srcs).toContain("/humanize/half.png");
    expect(srcs).toContain("/humanize/human.png");
  });

  it("shows transparent completed checks instead of a humanness percentage", async () => {
    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Looks natural")).toBeInTheDocument());
    expect(screen.getByText("No voice-rule issues")).toBeInTheDocument();
    expect(screen.getByText("No suggestions across 3 lenses")).toBeInTheDocument();
    expect(screen.queryByText(/reads human/i)).not.toBeInTheDocument();
  });

  it("reports exact deterministic and Humanize finding counts", async () => {
    (lintDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      violations: [{ id: "v1" }],
      repetitions: [{ id: "r1" }],
      hits: [],
    });
    (analyzeHumanize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      intensity: "medium",
      score: 85,
      lenses: [
        { key: "flow", label: "Flow & Rhythm", findings: [{ id: "f1" }] },
        { key: "soul", label: "De-robot / Soul", findings: [{ id: "f2" }] },
        { key: "voice", label: "Voice & POV", findings: [] },
      ],
    });

    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Voice rules need attention")).toBeInTheDocument());
    expect(screen.getByText("2 open findings")).toBeInTheDocument();
    expect(screen.getByText("2 suggestions across 3 lenses")).toBeInTheDocument();
  });

  it("reports an unavailable Humanize review instead of a partial score", async () => {
    (analyzeHumanize as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("HTTP 502"),
    );

    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Check incomplete")).toBeInTheDocument());
    expect(screen.getByText("Humanize review unavailable")).toBeInTheDocument();
    expect(screen.getByText("HTTP 502")).toBeInTheDocument();
  });

  it("reports an unavailable voice-rule check instead of a placeholder", async () => {
    (lintDraft as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("lint failed"));

    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText("Voice-rule check unavailable")).toBeInTheDocument(),
    );
    expect(screen.getByText("Check incomplete")).toBeInTheDocument();
  });

  it("switching intensity re-runs the pass and persists the choice", async () => {
    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "medium"));

    fireEvent.click(screen.getByRole("button", { name: /strong/i }));
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledWith("d1", "strong"));
    expect(localStorage.getItem("bf.humanize.intensity.d1")).toBe("strong");
  });

  it("does NOT re-analyze when the draft content changes (accepting a fix must not churn findings)", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledTimes(1));

    // An accepted AI fix mutates the draft content (same id, new object). The
    // panel must NOT run a fresh pass on that — doing so re-shuffles every other
    // finding under the writer (the reported bug).
    // biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
    const edited: any = {
      ...draft,
      sections: [{ id: "s1", title: "S", content_md: "x rewritten by an accepted fix" }],
    };
    rerender(
      <MemoryRouter>
        <HumanizePanel draft={edited} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(analyzeHumanize).toHaveBeenCalledTimes(1);
  });

  it("skips re-analyzing when a cached report exists for the current content + intensity", async () => {
    const hash = hashDraftContent(draft);
    const cached = {
      intensity: "medium" as const,
      score: 77,
      lenses: [{ key: "soul", label: "De-robot / Soul", findings: [] }],
    };
    setCached("humanize", draft.id, `${hash}:medium`, cached);

    render(
      <MemoryRouter>
        <HumanizePanel draft={draft} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
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
    render(
      <MemoryRouter>
        <HumanizePanel draft={d} onSectionSave={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    // radar axis label — always rendered, engaged or not
    await waitFor(() => expect(screen.getByText("flow")).toBeInTheDocument());
    // the flagged sentence is heat-mapped in the read pane
    await waitFor(() =>
      expect(screen.getAllByText(/serves as a gateway/i).length).toBeGreaterThan(0),
    );
  });

  it("AI fix opens the preview modal; Apply saves; nothing saves before Apply", async () => {
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
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    // biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
    const d: any = {
      id: "d1",
      title: "T",
      outline: { opening_hook: "h" },
      sections: [{ id: "s1", title: "S", content_md: "The API serves as a gateway. It adds 5ms." }],
    };
    render(
      <MemoryRouter>
        <HumanizePanel draft={d} onSectionSave={onSectionSave} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const aiFix = await screen.findByRole("button", { name: "AI fix" });
    fireEvent.click(aiFix);

    const dialog = await screen.findByRole("dialog", {
      name: /compare fix|comma-spliced|serves as a gateway|puffery/i,
    });
    expect(onSectionSave).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Original")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onSectionSave).toHaveBeenCalledWith(
        "s1",
        "The API is the gateway. It adds 5ms.",
        true,
      ),
    );
  });
});
