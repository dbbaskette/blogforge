import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "../../src/routes/SettingsPage";

vi.mock("../../src/api/linkedin", () => ({
  getLinkedInStatus: vi.fn(),
  connectLinkedIn: vi.fn(),
  disconnectLinkedIn: vi.fn(),
}));

const originalLocation = window.location;

afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
});

describe("SettingsPage — LinkedIn card", () => {
  it("shows Connect when not connected and redirects to authorize_url on click", async () => {
    const li = await import("../../src/api/linkedin");
    (li.getLinkedInStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ connected: false });
    (li.connectLinkedIn as ReturnType<typeof vi.fn>).mockResolvedValue({
      authorize_url: "https://www.linkedin.com/oauth/authorize?x=1",
    });

    // Spy on the full-page redirect.
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, href: "" },
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    const connectBtn = await screen.findByRole("button", { name: /connect linkedin/i });
    fireEvent.click(connectBtn);

    await waitFor(() => expect(li.connectLinkedIn).toHaveBeenCalled());
    await waitFor(() =>
      expect(window.location.href).toBe("https://www.linkedin.com/oauth/authorize?x=1"),
    );
  });

  it("shows the connected member name and a Disconnect button", async () => {
    const li = await import("../../src/api/linkedin");
    (li.getLinkedInStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      connected: true,
      member_name: "Ada Lovelace",
      expires_at: "2026-07-27T00:00:00Z",
    });
    (li.disconnectLinkedIn as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument());

    // After disconnect, status reloads as disconnected -> Connect button appears.
    (li.getLinkedInStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ connected: false });
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    await waitFor(() => expect(li.disconnectLinkedIn).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /connect linkedin/i })).toBeInTheDocument(),
    );
  });
});
