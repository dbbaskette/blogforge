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

  it("shows the request-received panel after a successful request", async () => {
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
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /request received/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/an admin will review your request/i)).toBeInTheDocument();
    // Back-to-sign-in returns to the form.
    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(screen.getByRole("tab", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows the waiting message (not an error) when sign-in returns status_pending", async () => {
    const { login } = await import("../../src/api/auth");
    (login as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("HTTP 403: status_pending"), { status: 403, code: "status_pending" }),
    );
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "wait@x.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /request received/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/an admin will review your request/i)).toBeInTheDocument();
  });
});
