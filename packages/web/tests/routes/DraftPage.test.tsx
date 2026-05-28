import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DraftPage } from "../../src/routes/DraftPage";

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "user", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../../src/api/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getMe: vi.fn().mockResolvedValue({
    id: "u1",
    email: "test@x.com",
    role: "user",
    status: "approved",
  }),
}));

vi.mock("../../src/api/drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/drafts")>();
  return {
    ...actual,
    getDraft: vi.fn().mockResolvedValue({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "My Test Draft",
      stage: "research",
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

// Keep ResearchPanel's network calls deterministic.
vi.mock("../../src/api/ideation", () => ({
  listIdeation: vi.fn().mockResolvedValue([]),
  postIdeationMessage: vi.fn(),
  acceptIdeation: vi.fn(),
}));

vi.mock("../../src/api/references", () => ({
  listReferences: vi.fn().mockResolvedValue([]),
  deleteReference: vi.fn(),
  addUrlReference: vi.fn(),
  addTextReference: vi.fn(),
  addFileReference: vi.fn(),
}));

vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));

vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: false }),
  listModels: vi.fn().mockResolvedValue([]),
}));

describe("DraftPage", () => {
  it("renders the ResearchPanel once a draft loads at the research stage", async () => {
    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Accept this outline/i })).toBeDisabled();
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
