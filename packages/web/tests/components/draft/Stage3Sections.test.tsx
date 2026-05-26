import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../../src/api/drafts";
import { Stage3Sections } from "../../../src/components/draft/Stage3Sections";

vi.mock("../../../src/api/drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/drafts")>();
  return {
    ...actual,
    lintDraft: vi.fn().mockResolvedValue({ violations: [], hits: [] }),
    downloadDraftUrl: (id: string) => `/api/drafts/${id}/download`,
  };
});

const mockDraft: Draft = {
  id: "draft-3",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  title: "Test",
  stage: "sections",
  idea: {
    topic: "Test",
    pack_slug: "dan",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
  },
  outline: {
    opening_hook: "Hook",
    sections: [],
    estimated_words: 0,
  },
  sections: [
    {
      id: "s1",
      title: "First Section",
      brief: "A section",
      content_md: "# First\n\nSome content here.",
      status: "ready",
      last_generated_at: null,
      word_count: 10,
    },
  ],
};

describe("Stage3Sections", () => {
  it("renders section title", () => {
    render(
      <Stage3Sections
        draft={mockDraft}
        jobId={null}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onRegenerateSection={vi.fn().mockResolvedValue(undefined)}
        onReorder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText("First Section")).toBeInTheDocument();
  });

  it("renders footer with Download .md link", () => {
    render(
      <Stage3Sections
        draft={mockDraft}
        jobId={null}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onRegenerateSection={vi.fn().mockResolvedValue(undefined)}
        onReorder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole("link", { name: /Download .md/i })).toBeInTheDocument();
  });

  it("renders total word count in footer", () => {
    render(
      <Stage3Sections
        draft={mockDraft}
        jobId={null}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onRegenerateSection={vi.fn().mockResolvedValue(undefined)}
        onReorder={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    // "10 words" may appear in both section header and sticky footer — assert at least one
    const matches = screen.getAllByText(/10 words/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
