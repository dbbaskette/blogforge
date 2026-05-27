import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DraftPage } from "../../src/routes/DraftPage";

vi.mock("../../src/api/drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/drafts")>();
  return {
    ...actual,
    getDraft: vi.fn().mockResolvedValue({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "My Test Draft",
      stage: "idea",
      idea: {
        topic: "My Test Draft",
        pack_slug: "dan",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        target_words: 1500,
      },
      outline: null,
      sections: [],
    }),
    updateDraft: vi.fn().mockImplementation((_, d) => Promise.resolve(d)),
  };
});

vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));

vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: false }),
  listModels: vi.fn().mockResolvedValue([]),
}));

describe("DraftPage", () => {
  it("renders the IdeaPanel once draft loads at the idea stage", async () => {
    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Generate outline/i })).toBeInTheDocument(),
    );
  });

  it("shows the back-to-drafts link and saved status", async () => {
    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/All drafts/i)).toBeInTheDocument());
    expect(screen.getByText(/All changes saved/i)).toBeInTheDocument();
  });
});
