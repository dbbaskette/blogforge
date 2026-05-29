import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Section } from "../../src/api/drafts";
import { SectionCard } from "../../src/components/draft/SectionCard";

function makeSection(over: Partial<Section> = {}): Section {
  return {
    id: "s1",
    title: "Opening",
    brief: "",
    content_md: "",
    status: "generating",
    last_generated_at: null,
    last_error: null,
    word_count: 0,
    ...over,
  };
}

const noop = async (): Promise<void> => {};

const baseProps = {
  index: 0,
  draftId: "draft-1",
  onSave: noop,
  onRegenerate: noop,
  onRevert: noop,
  onMoveUp: () => {},
  onMoveDown: () => {},
  canMoveUp: false,
  canMoveDown: false,
};

describe("SectionCard", () => {
  it("renders live streaming prose when given liveText", () => {
    render(
      <SectionCard
        {...baseProps}
        section={makeSection()}
        isGenerating
        liveText="The streaming first sentence"
        defaultOpen
      />,
    );
    expect(screen.getByText(/the streaming first sentence/i)).toBeInTheDocument();
  });

  it("falls back to the spinner while generating without live text", () => {
    render(<SectionCard {...baseProps} section={makeSection()} isGenerating defaultOpen />);
    expect(screen.getByText(/composing this section/i)).toBeInTheDocument();
  });

  it("passes a typed revision note to onRegenerate (guided regen)", async () => {
    const onRegenerate = vi.fn(async (): Promise<void> => {});
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "ready", content_md: "Existing prose.", word_count: 2 })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.change(screen.getByLabelText(/revision note/i), {
      target: { value: "tighten this" },
    });
    fireEvent.click(screen.getByRole("button", { name: /regenerate with note/i }));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith("tighten this"));
  });

  it("regenerates with no instruction when the note is blank", async () => {
    const onRegenerate = vi.fn(async (): Promise<void> => {});
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "ready", content_md: "Existing prose.", word_count: 2 })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^regenerate$/i }));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith(undefined));
  });
});
