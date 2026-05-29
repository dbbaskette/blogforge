import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

describe("SectionCard", () => {
  it("renders live streaming prose when given liveText", () => {
    render(
      <SectionCard
        section={makeSection()}
        index={0}
        isGenerating
        liveText="The streaming first sentence"
        defaultOpen
        onSave={noop}
        onRegenerate={noop}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
        canMoveUp={false}
        canMoveDown={false}
      />,
    );
    expect(screen.getByText(/the streaming first sentence/i)).toBeInTheDocument();
  });

  it("falls back to the spinner while generating without live text", () => {
    render(
      <SectionCard
        section={makeSection()}
        index={0}
        isGenerating
        defaultOpen
        onSave={noop}
        onRegenerate={noop}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
        canMoveUp={false}
        canMoveDown={false}
      />,
    );
    expect(screen.getByText(/composing this section/i)).toBeInTheDocument();
  });
});
