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
  vi.clearAllMocks();
  // jsdom lacks clipboard; stub it so the Copy action doesn't blow up.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("WorkspaceFooter", () => {
  it("shows the grouped menus + Preview + Review, and fires onLint", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByRole("button", { name: /improve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
    expect(baseProps.onLint).toHaveBeenCalled();
  });

  it("Improve menu opens the Shape / GEO / Headlines panels", () => {
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /improve/i }));
    fireEvent.click(screen.getByRole("button", { name: /shape assistant/i }));
    expect(baseProps.onShape).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /improve/i }));
    fireEvent.click(screen.getByRole("button", { name: /geo optimizer/i }));
    expect(baseProps.onGeo).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /improve/i }));
    fireEvent.click(screen.getByRole("button", { name: /headlines & hooks/i }));
    expect(baseProps.onHeadlines).toHaveBeenCalled();
  });

  it("Export menu lists copy, every format, and repurpose", () => {
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("button", { name: /copy markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^markdown \(\.md\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /frontmatter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /web page \(\.html\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /word \(\.docx\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /repurpose/i }));
    expect(baseProps.onRepurpose).toHaveBeenCalled();
  });

  it("downloads via fetch with credentials and the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'attachment; filename="post.md"' },
      blob: async () => new Blob(["# hi"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
    URL.revokeObjectURL = vi.fn();

    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("button", { name: /^markdown \(\.md\)/i }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/drafts/d1/download?format=md"),
        expect.objectContaining({ credentials: "include" }),
      ),
    );
    vi.unstubAllGlobals();
  });

  it("shows an error instead of downloading when the export fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("button", { name: /^markdown \(\.md\)/i }));
    await vi.waitFor(() => expect(screen.getByText(/session expired/i)).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it("shows the word + drafted-count stats", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });
});
