import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../src/api/drafts";
import { SectionsPanel } from "../../src/components/draft/SectionsPanel";

function makeDraft(): Draft {
  return {
    id: "d1",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    title: "My Essay",
    stage: "sections",
    idea: { topic: "My Essay", pack_slug: "dan", provider: "anthropic", model: "m" },
    outline: { opening_hook: "A hook.", sections: [], estimated_words: 0 },
    sections: [
      {
        id: "s1",
        title: "First Section",
        brief: "",
        content_md: "The first section prose.",
        status: "ready",
        last_generated_at: null,
        last_error: null,
        word_count: 4,
      },
    ],
    tags: [],
    hero_image_key: null,
  };
}

const noop = async (): Promise<void> => {};

const baseProps = {
  generatingIds: new Set<string>(),
  jobError: null,
  onDismissJobError: () => {},
  unfilledCount: 0,
  jobRunning: false,
  onSectionSave: noop,
  onRegenerateSection: noop,
  onRevertSection: noop,
  onReorder: noop,
  onExpandUnfilled: noop,
  onReviseDraft: noop,
};

describe("SectionsPanel", () => {
  it("switches to a continuous read view", () => {
    render(<SectionsPanel {...baseProps} draft={makeDraft()} onReviseDraft={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /^read$/i }));
    // The assembled read view renders the title as a heading.
    expect(screen.getByRole("heading", { name: /my essay/i })).toBeInTheDocument();
    expect(screen.getByText(/the first section prose/i)).toBeInTheDocument();
  });

  it("composes the whole draft in one pass", () => {
    const onExpandUnfilled = vi.fn(async (): Promise<void> => {});
    render(
      <SectionsPanel
        {...baseProps}
        draft={makeDraft()}
        unfilledCount={5}
        onExpandUnfilled={onExpandUnfilled}
        onReviseDraft={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /compose draft/i }));
    expect(onExpandUnfilled).toHaveBeenCalled();
    // The incremental "draft next N" button is gone — single-pass is whole-doc.
    expect(screen.queryByRole("button", { name: /draft next/i })).not.toBeInTheDocument();
  });

  it("shows one unified composing state (not per-section) during a single-pass compose", () => {
    render(
      <SectionsPanel
        {...baseProps}
        draft={makeDraft()}
        jobRunning
        composingWholeDraft
        onReviseDraft={noop}
      />,
    );
    expect(screen.getByText(/composing your full draft/i)).toBeInTheDocument();
    // The per-section card and the N/total per-section banner are suppressed.
    expect(screen.queryByText(/the first section prose/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sections$/i)).not.toBeInTheDocument();
  });

  it("submits a holistic revision instruction", async () => {
    const onReviseDraft = vi.fn(async (): Promise<void> => {});
    render(<SectionsPanel {...baseProps} draft={makeDraft()} onReviseDraft={onReviseDraft} />);

    fireEvent.click(screen.getByRole("button", { name: /revise whole draft/i }));
    fireEvent.change(screen.getByLabelText(/revise the whole draft/i), {
      target: { value: "smooth the transitions" },
    });
    fireEvent.click(screen.getByRole("button", { name: /revise 1 section/i }));

    await waitFor(() => expect(onReviseDraft).toHaveBeenCalledWith("smooth the transitions"));
  });
});
