import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LoginPage } from "../../src/routes/LoginPage";

describe("LoginPage", () => {
  it("renders a Sign in with GitHub link pointing to /api/auth/github/login", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /sign in with github/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/api/auth/github/login");
  });

  it("shows no error banner when no ?error param is present", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/isn't on the allowlist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign-in error/i)).not.toBeInTheDocument();
  });

  it("maps known error codes to friendly messages", () => {
    // Simulate ?error=not_allowed in window.location.search
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "?error=not_allowed" },
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("That GitHub account isn't on the allowlist."),
    ).toBeInTheDocument();
    // Restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "" },
    });
  });

  it("shows a generic message for unknown error codes", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "?error=unknown_code" },
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Sign-in error.")).toBeInTheDocument();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "" },
    });
  });
});
