import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../../src/components/RequireAuth";

vi.mock("../../src/api/auth", () => ({
  getMe: vi.fn(),
}));

describe("RequireAuth", () => {
  it("renders children when /api/auth/me succeeds", async () => {
    const { getMe } = await import("../../src/api/auth");
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "user",
      status: "approved",
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <div>secret content</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/secret content/)).toBeInTheDocument());
  });

  it("redirects to /login when /api/auth/me errors", async () => {
    const { getMe } = await import("../../src/api/auth");
    (getMe as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("401"), { status: 401 }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <div>secret content</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/login page/)).toBeInTheDocument());
  });
});
