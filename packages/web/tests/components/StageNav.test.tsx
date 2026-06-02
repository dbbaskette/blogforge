import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../src/api/drafts";
import { StageNav } from "../../src/components/draft/StageNav";

function makeDraft(over: Partial<Draft> = {}): Draft {
  return {
    id: "d1",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    title: "T",
    stage: "sections",
    idea: { topic: "T", pack_slug: "dan", provider: "anthropic", model: "m" },
    outline: { opening_hook: "h", sections: [], estimated_words: 0 },
    sections: [
      {
        id: "s1", title: "First", brief: "", content_md: "x",
        status: "ready", last_generated_at: null, last_error: null, word_count: 1,
      },
    ],
    tags: [],
    hero_image_key: null,
    ...over,
  };
}

describe("StageNav", () => {
  it("jumps back to research from a later stage", () => {
    const onJump = vi.fn();
    render(<StageNav draft={makeDraft()} onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: /talk it through/i }));
    expect(onJump).toHaveBeenCalledWith("research");
  });

  it("disables stages not yet reached", () => {
    const onJump = vi.fn();
    // research stage, no outline / sections → outline + draft unreachable
    render(
      <StageNav
        draft={makeDraft({ stage: "research", outline: null, sections: [] })}
        onJump={onJump}
      />,
    );
    expect(screen.getByRole("button", { name: /outline/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^draft$/i })).toBeDisabled();
  });

  it("marks the current stage and doesn't fire onJump for it", () => {
    const onJump = vi.fn();
    render(<StageNav draft={makeDraft()} onJump={onJump} />);
    const current = screen.getByRole("button", { name: /^draft$/i });
    expect(current).toHaveAttribute("aria-current", "step");
    fireEvent.click(current);
    expect(onJump).not.toHaveBeenCalled();
  });
});
