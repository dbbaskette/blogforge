import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { LoginPage } from "../../src/routes/LoginPage";

vi.mock("../../src/api/auth", () => ({
  login: vi.fn(),
  requestAccess: vi.fn(),
  getMe: vi.fn(),
}));

describe("LoginPage", () => {
  it("renders both Sign in and Request access tabs", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /request access/i })).toBeInTheDocument();
  });

  it("calls login() on submit", async () => {
    const { login } = await import("../../src/api/auth");
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "ok" });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a@b.com", "secret123"));
  });

  it("switches to Request access tab and calls requestAccess()", async () => {
    const { requestAccess } = await import("../../src/api/auth");
    (requestAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "pending" });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /request access/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "new@user.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "secret123" },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    await waitFor(() => expect(requestAccess).toHaveBeenCalledWith("new@user.com", "secret123"));
  });
});
