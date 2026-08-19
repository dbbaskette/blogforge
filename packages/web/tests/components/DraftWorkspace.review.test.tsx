import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/drafts")>("../../src/api/drafts");
  return { ...actual, checkClaims: vi.fn(), lintDraft: vi.fn() };
});
vi.mock("../../src/api/geo", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/geo")>("../../src/api/geo");
  return { ...actual, analyzeGeo: vi.fn() };
});
vi.mock("../../src/api/humanize", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/humanize")>("../../src/api/humanize");
  return { ...actual, analyzeHumanize: vi.fn() };
});
vi.mock("../../src/api/references", () => ({ listReferences: vi.fn() }));
vi.mock("../../src/api/suggest", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/suggest")>("../../src/api/suggest");
  return { ...actual, suggestImprovements: vi.fn() };
});

import { type Draft, checkClaims, lintDraft } from "../../src/api/drafts";
import { analyzeGeo } from "../../src/api/geo";
import { analyzeHumanize } from "../../src/api/humanize";
import { listReferences } from "../../src/api/references";
import { suggestImprovements } from "../../src/api/suggest";
import { DraftWorkspace } from "../../src/components/draft/DraftWorkspace";

const draft: Draft = {
  id: "review-routing-draft",
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
  title: "Review routing",
  stage: "sections",
  idea: { topic: "Review routing", pack_slug: "dan", provider: "anthropic", model: "model" },
  outline: {
    opening_hook: "",
    sections: [{ id: "s1", title: "First section", brief: "Explain the point" }],
    estimated_words: 400,
  },
  sections: [
    {
      id: "s1",
      title: "First section",
      brief: "Explain the point",
      content_md: "This draft sentence.",
      status: "ready",
      last_generated_at: null,
      word_count: 3,
    },
  ],
  tags: [],
  hero_image_key: null,
};

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
let scrolledElementId: string | null = null;
const scrollIntoView = vi.fn(function (this: HTMLElement) {
  scrolledElementId = this.id;
});

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = undefined;
  }
});

describe("DraftWorkspace Review routing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    scrolledElementId = null;
    vi.mocked(lintDraft).mockResolvedValue({
      violations: [
        {
          id: "v1",
          kind: "violation",
          section_id: "s1",
          start: 5,
          end: 10,
          match: "draft",
          rule: "voice",
          message: "Use concrete wording.",
        },
      ],
      repetitions: [],
      hits: [],
    });
    vi.mocked(checkClaims).mockResolvedValue({
      has_references: true,
      claims: [],
    });
    vi.mocked(analyzeGeo).mockResolvedValue({ score: 90, grade: "A", levers: [] });
    vi.mocked(analyzeHumanize).mockResolvedValue({
      intensity: "medium",
      score: 95,
      lenses: [],
    });
    vi.mocked(suggestImprovements).mockResolvedValue({ reword: [] });
    vi.mocked(listReferences).mockResolvedValue([]);
  });

  it("places the next action below the stage nav and opens Review Center from it", async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DraftWorkspace
          draft={draft}
          jobId={null}
          saving={false}
          saveError={null}
          onChange={vi.fn().mockResolvedValue(undefined)}
          onGenerateOutline={vi.fn().mockResolvedValue(undefined)}
          onExpandAll={vi.fn().mockResolvedValue(undefined)}
          onExpandUnfilled={vi.fn().mockResolvedValue(undefined)}
          onSectionSave={vi.fn().mockResolvedValue(undefined)}
          onRegenerateSection={vi.fn().mockResolvedValue(undefined)}
          onRevertSection={vi.fn().mockResolvedValue(undefined)}
          onReviseDraft={vi.fn().mockResolvedValue(undefined)}
          onJumpStage={vi.fn().mockResolvedValue(undefined)}
          onReorder={vi.fn().mockResolvedValue(undefined)}
          onJobComplete={vi.fn()}
        />
      </MemoryRouter>,
    );

    const stageNav = screen.getByRole("navigation", { name: "Writing stage" });
    const next = screen.getByRole("region", { name: "NEXT" });
    expect(stageNav.nextElementSibling).toBe(next);

    fireEvent.click(screen.getByRole("button", { name: "Review draft" }));
    expect(await screen.findByRole("dialog", { name: "Review Center" })).toBeInTheDocument();
  });

  it("opens proofread from a section-aware review row, scrolls its section, and saves a fix", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DraftWorkspace
          draft={draft}
          jobId={null}
          saving={false}
          saveError={null}
          onChange={vi.fn().mockResolvedValue(undefined)}
          onGenerateOutline={vi.fn().mockResolvedValue(undefined)}
          onExpandAll={vi.fn().mockResolvedValue(undefined)}
          onExpandUnfilled={vi.fn().mockResolvedValue(undefined)}
          onSectionSave={onSectionSave}
          onRegenerateSection={vi.fn().mockResolvedValue(undefined)}
          onRevertSection={vi.fn().mockResolvedValue(undefined)}
          onReviseDraft={vi.fn().mockResolvedValue(undefined)}
          onJumpStage={vi.fn().mockResolvedValue(undefined)}
          onReorder={vi.fn().mockResolvedValue(undefined)}
          onJobComplete={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.getElementById("section-s1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^review$/i }));

    const reviewCenter = await screen.findByRole("dialog", { name: "Review Center" });
    const proofread = await within(reviewCenter).findByRole("region", { name: "Proofread review" });
    fireEvent.click(within(proofread).getByRole("button", { name: "Open Proofread" }));

    const proofreader = await screen.findByRole("dialog", { name: "Proofreader" });
    expect(screen.queryByRole("dialog", { name: "Review Center" })).not.toBeInTheDocument();
    expect(scrolledElementId).toBe("section-s1");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(await within(proofreader).findByText("Use concrete wording.")).toBeInTheDocument();

    fireEvent.click(within(proofreader).getByRole("button", { name: "Manual fix" }));
    fireEvent.change(within(proofreader).getByRole("textbox"), {
      target: { value: "Rewritten sentence." },
    });
    fireEvent.click(within(proofreader).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(onSectionSave).toHaveBeenCalledWith("s1", "Rewritten sentence."));
  });

  it("reuses Review Center factual results when opening the specialist", async () => {
    vi.mocked(listReferences).mockResolvedValue([
      {
        id: "r1",
        kind: "url",
        name: "Primary source",
        url: "https://example.com/source",
        original_filename: null,
        extracted_chars: 500,
        added_at: "2026-08-17T00:00:00Z",
      },
    ]);
    vi.mocked(checkClaims).mockResolvedValue({
      has_references: true,
      claims: [
        {
          text: "The launch happened in 2024.",
          status: "unsupported",
          note: "The attached source does not give a launch date.",
        },
      ],
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DraftWorkspace
          draft={draft}
          jobId={null}
          saving={false}
          saveError={null}
          onChange={vi.fn().mockResolvedValue(undefined)}
          onGenerateOutline={vi.fn().mockResolvedValue(undefined)}
          onExpandAll={vi.fn().mockResolvedValue(undefined)}
          onExpandUnfilled={vi.fn().mockResolvedValue(undefined)}
          onSectionSave={vi.fn().mockResolvedValue(undefined)}
          onRegenerateSection={vi.fn().mockResolvedValue(undefined)}
          onRevertSection={vi.fn().mockResolvedValue(undefined)}
          onReviseDraft={vi.fn().mockResolvedValue(undefined)}
          onJumpStage={vi.fn().mockResolvedValue(undefined)}
          onReorder={vi.fn().mockResolvedValue(undefined)}
          onJobComplete={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
    const reviewCenter = await screen.findByRole("dialog", { name: "Review Center" });
    const factual = await within(reviewCenter).findByRole("region", {
      name: "Factual support review",
    });
    fireEvent.click(within(factual).getByRole("button", { name: "Open Factual support" }));

    const proofreader = await screen.findByRole("dialog", { name: "Proofreader" });
    expect(
      await within(proofreader).findByText("The launch happened in 2024."),
    ).toBeInTheDocument();
    expect(checkClaims).toHaveBeenCalledTimes(1);
  });
});
