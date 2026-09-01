import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandPalette, PALETTE_ACTION_EVENT } from "../../src/components/CommandPalette";
import { ToastProvider } from "../../src/components/ui/Toast";

vi.mock("../../src/api/drafts", () => ({
  listDrafts: vi.fn().mockResolvedValue([
    {
      id: "d1",
      title: "Cast iron basics",
      stage: "sections",
      pack_slug: "dan",
      updated_at: "2026-08-01T00:00:00Z",
      word_count: 100,
      tags: [],
    },
  ]),
  downloadDraftUrl: (id: string) => `/api/drafts/${id}/download`,
}));

function renderAt(path: string): { unmount: () => void } {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <CommandPalette onClose={() => {}} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CommandPalette", () => {
  it("lists navigation commands and open-draft entries", async () => {
    renderAt("/");
    expect(screen.getByText("New piece")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/open: cast iron basics/i)).toBeInTheDocument());
  });

  it("offers per-draft actions only on a draft page", async () => {
    const draft = renderAt("/drafts/d1");
    await waitFor(() => expect(screen.getByText("Proofread this draft")).toBeInTheDocument());
    draft.unmount();

    // Not shown on the drafts index.
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <CommandPalette onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Proofread this draft")).not.toBeInTheDocument();
    unmount();
  });

  it("dispatches a workspace event when a draft action runs", async () => {
    const listener = vi.fn();
    window.addEventListener(PALETTE_ACTION_EVENT, listener);
    try {
      renderAt("/drafts/d1");
      fireEvent.click(await screen.findByText("Proofread this draft"));
      expect(listener).toHaveBeenCalledTimes(1);
      const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.action).toBe("proofread");
    } finally {
      window.removeEventListener(PALETTE_ACTION_EVENT, listener);
    }
  });

  it("filters results by query", async () => {
    renderAt("/");
    const input = screen.getByLabelText(/search commands and drafts/i);
    fireEvent.change(input, { target: { value: "voice" } });
    expect(screen.getByText("Your Voice")).toBeInTheDocument();
    expect(screen.queryByText("New piece")).not.toBeInTheDocument();
  });

  it("keeps the editor open and reports an authenticated download failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/drafts/d1");

    fireEvent.click(await screen.findByText("Download .md"));

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/drafts/d1/download", {
      credentials: "include",
    });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });
});
