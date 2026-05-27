import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../../src/api/drafts";
import { Stage1Idea } from "../../../src/components/draft/Stage1Idea";

vi.mock("../../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));
vi.mock("../../../src/api/providers", () => ({
  listProviderAvailability: vi
    .fn()
    .mockResolvedValue({ anthropic: false, openai: false, google: false }),
  listModels: vi.fn().mockResolvedValue([]),
}));

const mockDraft: Draft = {
  id: "draft-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  title: "Test topic",
  stage: "idea",
  idea: {
    topic: "Test topic",
    bullets: [],
    pack_slug: "dan",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    target_words: 1500,
    notes: "",
  },
  outline: null,
  sections: [],
};

describe("Stage1Idea", () => {
  it("renders topic field with initial value", () => {
    render(
      <Stage1Idea
        draft={mockDraft}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const input = screen.getByDisplayValue("Test topic");
    expect(input).toBeInTheDocument();
  });

  it("renders Generate outline button", () => {
    render(
      <Stage1Idea
        draft={mockDraft}
        onChange={vi.fn().mockResolvedValue(undefined)}
        onAdvance={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: /Generate outline/i })).toBeInTheDocument();
  });
});
