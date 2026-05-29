import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "../../src/routes/SettingsPage";

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: {
      id: "u1",
      email: "test@x.com",
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
  changePassword: vi.fn(),
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
    await waitFor(() => expect(screen.getByText("test@x.com")).toBeInTheDocument());
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText(/last sign-in/i)).toBeInTheDocument();
  });

  it("calls changePassword with the right args and shows success", async () => {
    const { changePassword } = await import("../../src/api/auth");
    (changePassword as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "ok" });
    renderPage();

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: "oldpass12" },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "newpass12" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "newpass12" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("oldpass12", "newpass12"));
    await waitFor(() => expect(screen.getByText(/password changed/i)).toBeInTheDocument());
  });

  it("maps invalid_old_password to a friendly error", async () => {
    const { changePassword } = await import("../../src/api/auth");
    (changePassword as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("HTTP 400: invalid_old_password"),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: "wrongpass" },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "newpass12" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "newpass12" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() =>
      expect(screen.getByText(/current password is incorrect/i)).toBeInTheDocument(),
    );
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
