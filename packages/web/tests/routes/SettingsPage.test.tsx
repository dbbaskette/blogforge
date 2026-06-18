import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "../../src/routes/SettingsPage";

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: {
      id: "u1",
      email: "test@x.com",
      github_login: "testuser",
      avatar_url: null,
      role: "admin",
      status: "approved",
      last_login_at: "2026-05-27T12:00:00Z",
    },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

vi.mock("../../src/api/auth", () => ({
  revokeAllSessions: vi.fn(),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  it("renders the account details for the current user", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /account/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("testuser")).toBeInTheDocument());
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText(/last sign-in/i)).toBeInTheDocument();
  });

  it("does not render a change-password form", () => {
    renderPage();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("calls revokeAllSessions when Sign out everywhere is confirmed", async () => {
    const { revokeAllSessions } = await import("../../src/api/auth");
    (revokeAllSessions as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /sign out everywhere/i }));
    await waitFor(() => expect(revokeAllSessions).toHaveBeenCalledTimes(1));
  });
});
