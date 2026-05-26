import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../../src/api/drafts";
import { Stage2Outline } from "../../../src/components/draft/Stage2Outline";

const mockDraft: Draft = {
  id: "draft-2",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  title: "Test",
  stage: "outline",
  idea: {
    topic: "Test",
    pack_slug: "dan",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
  },
  outline: {
    opening_hook: "A great opening hook.",
    sections: [
      { id: "s1", title: "Intro", brief: "The intro section" },
      { id: "s2", title: "Conclusion", brief: "The conclusion" },
    ],
    estimated_words: 1200,
  },
  sections: [],
};

describe("Stage2Outline", () => {
  it("renders opening hook", () => {
    render(
      <Stage2Outline
        draft={mockDraft}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
        onRegenerate={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("A great opening hook.")).toBeInTheDocument();
  });

  it("renders section titles", () => {
    render(
      <Stage2Outline
        draft={mockDraft}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
        onRegenerate={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Intro")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Conclusion")).toBeInTheDocument();
  });

  it("renders Expand all sections button", () => {
    render(
      <Stage2Outline
        draft={mockDraft}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
        onRegenerate={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Expand all sections/i })).toBeInTheDocument();
  });
});
