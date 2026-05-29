import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TrashPage } from "../../src/routes/TrashPage";

vi.mock("../../src/api/drafts", () => ({
  listTrashedDrafts: vi.fn(),
  restoreDraft: vi.fn(),
  hardDeleteDraft: vi.fn(),
}));

const trashed = [
  {
    id: "d1",
    title: "An old idea",
    stage: "outline" as const,
    pack_slug: "myvoice",
    updated_at: "2026-05-27T00:00:00Z",
    word_count: 42,
  },
];

describe("TrashPage", () => {
  it("renders the trashed list", async () => {
    const drafts = await import("../../src/api/drafts");
    (drafts.listTrashedDrafts as ReturnType<typeof vi.fn>).mockResolvedValue(trashed);

    render(
      <MemoryRouter>
        <TrashPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("An old idea")).toBeInTheDocument());
  });

  it("shows the empty state when there are no trashed drafts", async () => {
    const drafts = await import("../../src/api/drafts");
    (drafts.listTrashedDrafts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <TrashPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/trash is empty/i)).toBeInTheDocument());
  });

  it("Restore calls restoreDraft", async () => {
    const drafts = await import("../../src/api/drafts");
    (drafts.listTrashedDrafts as ReturnType<typeof vi.fn>).mockResolvedValue(trashed);
    (drafts.restoreDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1" });

    render(
      <MemoryRouter>
        <TrashPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("An old idea")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(drafts.restoreDraft).toHaveBeenCalledWith("d1"));
  });

  it("Delete forever calls hardDeleteDraft after confirm", async () => {
    const drafts = await import("../../src/api/drafts");
    (drafts.listTrashedDrafts as ReturnType<typeof vi.fn>).mockResolvedValue(trashed);
    (drafts.hardDeleteDraft as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <TrashPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("An old idea")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete forever/i }));
    await waitFor(() => expect(drafts.hardDeleteDraft).toHaveBeenCalledWith("d1"));
  });
});
