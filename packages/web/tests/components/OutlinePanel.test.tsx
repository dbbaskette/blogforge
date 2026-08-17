import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiError } from "../../src/api/client";
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

  it("preserves the outline and offers Retry while validation details stay secondary", async () => {
    const onRegenerate = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('HTTP 422: [{"loc":["body","topic"]}]'), {
          status: 422,
          detail: [{ loc: ["body", "topic"], msg: "Field required" }],
        }) as ApiError,
      )
      .mockResolvedValueOnce(undefined);
    render(
      <OutlinePanel
        draft={draft}
        onChange={vi.fn()}
        onApplyTitle={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate outline/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Check the information");
    expect(screen.getByDisplayValue("An opening.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("First")).toBeInTheDocument();
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("HTTP 422");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledTimes(2));
  });
});
