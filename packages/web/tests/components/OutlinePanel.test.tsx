import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../src/api/drafts";
import { OutlinePanel } from "../../src/components/draft/OutlinePanel";

const draft: Draft = {
  id: "outline-draft",
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
  title: "A planned essay",
  stage: "outline",
  idea: { topic: "A planned essay", pack_slug: "house", provider: "openai", model: "gpt" },
  outline: {
    opening_hook: "An opening.",
    sections: [{ id: "s1", title: "First", brief: "Make the case" }],
    estimated_words: 800,
  },
  sections: [],
  tags: [],
  hero_image_key: null,
};

describe("OutlinePanel", () => {
  it("leaves compose progression to the workspace next action", () => {
    render(
      <OutlinePanel
        draft={draft}
        onChange={vi.fn()}
        onApplyTitle={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /compose 1 section/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate outline/i })).toBeInTheDocument();
  });
});
