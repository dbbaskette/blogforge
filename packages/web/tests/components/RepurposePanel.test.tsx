import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Draft,
  listRepurposeFormats,
  repurposeDraft,
  saveRepurposeDraft,
} from "../../src/api/drafts";
import { RepurposePanel } from "../../src/components/draft/RepurposePanel";

vi.mock("../../src/api/drafts", () => ({
  listRepurposeFormats: vi.fn(),
  repurposeDraft: vi.fn(),
  saveRepurposeDraft: vi.fn(),
}));

const formats = [
  { id: "summary", label: "Summarized version" },
  { id: "extended", label: "Extended version" },
  { id: "linkedin", label: "LinkedIn post (feed)" },
];

const controlledResult = {
  format: "summary",
  text: "A concise generated preview.",
  length: {
    metric: "words" as const,
    actual: 100,
    minimum: 90,
    maximum: 110,
    within_target: true,
    correction_attempted: false,
  },
};

const savedDraft: Draft = {
  id: "new-draft",
  created_at: "2026-07-29T12:00:00Z",
  updated_at: "2026-07-29T12:00:00Z",
  title: "Original — Summary",
  stage: "sections",
  idea: {
    topic: "Original — Summary",
    pack_slug: "dan",
    provider: "anthropic",
    model: "m",
  },
  outline: {
    opening_hook: "",
    sections: [{ id: "section-1", title: "Summary", brief: "" }],
    estimated_words: 100,
  },
  sections: [
    {
      id: "section-1",
      title: "Summary",
      brief: "",
      content_md: controlledResult.text,
      status: "edited",
      last_generated_at: null,
      word_count: 100,
    },
  ],
  tags: ["source"],
  hero_image_key: null,
};

function LocationProbe(): JSX.Element {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPanel(): void {
  render(
    <MemoryRouter initialEntries={["/drafts/source"]}>
      <RepurposePanel draftId="source" onClose={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRepurposeFormats).mockResolvedValue(formats);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("RepurposePanel length variations", () => {
  it("shows the three requested length choices", async () => {
    renderPanel();

    expect(await screen.findByRole("button", { name: /summarized version/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /extended version/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /linkedin post/i })).toBeInTheDocument();
  });

  it("shows actual and target lengths for a controlled preview", async () => {
    vi.mocked(repurposeDraft).mockResolvedValue(controlledResult);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /summarized version/i }));

    expect(await screen.findByText(/100 words/i)).toBeInTheDocument();
    expect(screen.getByText(/target 90–110/i)).toBeInTheDocument();
  });

  it("warns but still allows saving an out-of-range preview", async () => {
    vi.mocked(repurposeDraft).mockResolvedValue({
      format: "linkedin",
      text: "A short LinkedIn preview.",
      length: {
        metric: "characters",
        actual: 1200,
        minimum: 1300,
        maximum: 1600,
        within_target: false,
        correction_attempted: true,
      },
    });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /linkedin post/i }));

    expect(await screen.findByText(/outside the target range/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save as new draft/i })).toBeEnabled();
  });

  it("saves the preview and navigates to the new draft", async () => {
    vi.mocked(repurposeDraft).mockResolvedValue(controlledResult);
    vi.mocked(saveRepurposeDraft).mockResolvedValue(savedDraft);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /summarized version/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save as new draft/i }));

    await waitFor(() =>
      expect(saveRepurposeDraft).toHaveBeenCalledWith("source", "summary", controlledResult.text),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/drafts/new-draft");
  });

  it("keeps the preview visible when saving fails", async () => {
    vi.mocked(repurposeDraft).mockResolvedValue(controlledResult);
    vi.mocked(saveRepurposeDraft).mockRejectedValue(new Error("Could not save variation"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /summarized version/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save as new draft/i }));

    expect(await screen.findByText("Could not save variation")).toBeInTheDocument();
    expect(screen.getByText(controlledResult.text)).toBeInTheDocument();
  });
});
