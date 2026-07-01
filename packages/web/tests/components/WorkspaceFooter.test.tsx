import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Draft } from "../../src/api/drafts";
import { WorkspaceFooter } from "../../src/components/draft/WorkspaceFooter";

const draft: Draft = {
  id: "d1",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  title: "My Essay",
  stage: "sections",
  idea: { topic: "My Essay", pack_slug: "dan", provider: "anthropic", model: "m" },
  outline: { opening_hook: "", sections: [], estimated_words: 0 },
  sections: [],
  tags: [],
  hero_image_key: null,
};

const baseProps = {
  draft,
  totalWords: 120,
  draftedCount: 2,
  sectionCount: 2,
  onLint: vi.fn(),
  onRepurpose: vi.fn(),
  onHeadlines: vi.fn(),
  onShape: vi.fn(),
  onGeo: vi.fn(),
};

beforeEach(() => {
  // jsdom lacks clipboard; stub it so the Copy button doesn't blow up.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("WorkspaceFooter", () => {
  it("renders Copy, Download and Review and fires onLint", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByRole("button", { name: /copy markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
    expect(baseProps.onLint).toHaveBeenCalled();
  });

  it("fires onRepurpose when the Repurpose button is clicked", () => {
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^repurpose$/i }));
    expect(baseProps.onRepurpose).toHaveBeenCalled();
  });

  it("fires onShape when the Shape button is clicked", () => {
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^shape$/i }));
    expect(baseProps.onShape).toHaveBeenCalled();
  });

  it("fires onGeo when the GEO button is clicked", () => {
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^geo$/i }));
    expect(baseProps.onGeo).toHaveBeenCalled();
  });

  it("opens a menu with every export format", () => {
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    const html = screen.getByRole("link", { name: /web page \(\.html\)/i });
    const docx = screen.getByRole("link", { name: /word \(\.docx\)/i });
    expect(screen.getByRole("link", { name: /^markdown \(\.md\)/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /frontmatter/i })).toBeInTheDocument();
    expect(html).toHaveAttribute("href", expect.stringContaining("format=html"));
    expect(docx).toHaveAttribute("href", expect.stringContaining("format=docx"));
  });

  it("shows the word + drafted-count stats", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });
});
