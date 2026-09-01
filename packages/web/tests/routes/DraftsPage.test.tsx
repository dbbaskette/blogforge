import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DraftSummary, deleteDraft, listDrafts, restoreDraft } from "../../src/api/drafts";
import { ToastProvider } from "../../src/components/ui/Toast";
import { DraftsPage } from "../../src/routes/DraftsPage";

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
vi.mock("../../src/api/drafts", () => ({
  listDrafts: vi.fn(),
  deleteDraft: vi.fn(),
  restoreDraft: vi.fn().mockResolvedValue({}),
  setDraftTags: vi.fn(),
}));
vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi
    .fn()
    .mockResolvedValue({ anthropic: true, openai: false, google: false }),
}));

function summary(over: Partial<DraftSummary>): DraftSummary {
  return {
    id: "d",
    title: "Untitled",
    stage: "research",
    pack_slug: "dan",
    updated_at: "2026-05-01T00:00:00Z",
    word_count: 0,
    tags: [],
    ...over,
  };
}

describe("DraftsPage", () => {
  beforeEach(() => vi.mocked(listDrafts).mockReset());

  it("renders empty state", async () => {
    vi.mocked(listDrafts).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument());
  });

  it("filters the list by search query", async () => {
    vi.mocked(listDrafts).mockResolvedValue([
      summary({ id: "a", title: "Agents in production" }),
      summary({ id: "b", title: "Cooking with cast iron" }),
    ]);
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/agents in production/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search drafts/i), { target: { value: "cast iron" } });

    expect(screen.queryByText(/agents in production/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cooking with cast iron/i)).toBeInTheDocument();
  });

  it("filters the list by tag chip", async () => {
    vi.mocked(listDrafts).mockResolvedValue([
      summary({ id: "a", title: "Tagged essay", tags: ["essay"] }),
      summary({ id: "b", title: "Tagged recipe", tags: ["recipe"] }),
    ]);
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/tagged essay/i)).toBeInTheDocument());

    // Tag-filter chip (not the per-card tag chip) lives in the toolbar.
    fireEvent.click(screen.getByRole("button", { name: "essay", pressed: false }));

    expect(screen.getByText(/tagged essay/i)).toBeInTheDocument();
    expect(screen.queryByText(/tagged recipe/i)).not.toBeInTheDocument();
  });

  it("shows an error toast when delete fails", async () => {
    vi.mocked(listDrafts).mockResolvedValue([summary({ id: "a", title: "Doomed draft" })]);
    vi.mocked(deleteDraft).mockRejectedValue(new Error("Network down"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(
        <MemoryRouter>
          <ToastProvider>
            <DraftsPage />
          </ToastProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText(/doomed draft/i)).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /delete doomed draft/i }));

      await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
      // The failed draft is still in the list.
      expect(screen.getByText(/doomed draft/i)).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("offers Undo after a successful delete", async () => {
    vi.mocked(listDrafts)
      .mockResolvedValueOnce([summary({ id: "a", title: "Deleted essay" })])
      .mockResolvedValue([]); // post-delete reload
    vi.mocked(deleteDraft).mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(
        <MemoryRouter>
          <ToastProvider>
            <DraftsPage />
          </ToastProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText(/deleted essay/i)).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /delete deleted essay/i }));

      const undo = await screen.findByRole("button", { name: "Undo" });
      expect(undo).toBeInTheDocument();
      fireEvent.click(undo);
      await waitFor(() => expect(restoreDraft).toHaveBeenCalledWith("a"));
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
