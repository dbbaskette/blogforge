import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminPage } from "../../src/routes/AdminPage";

vi.mock("../../src/api/admin", () => ({
  listUsers: vi.fn(),
  approveUser: vi.fn(),
  rejectUser: vi.fn(),
  disableUser: vi.fn(),
  promoteUser: vi.fn(),
}));

// Keep the ProviderKeysSection from making a real network call in tests.
vi.mock("../../src/api/adminKeys", () => ({
  listProviderKeys: vi.fn().mockResolvedValue([
    {
      provider: "anthropic",
      configured: false,
      source: "none",
      updated_at: null,
      updated_by: null,
    },
    { provider: "google", configured: false, source: "none", updated_at: null, updated_by: null },
    { provider: "openai", configured: false, source: "none", updated_at: null, updated_by: null },
  ]),
  setProviderKey: vi.fn(),
  deleteProviderKey: vi.fn(),
}));

describe("AdminPage", () => {
  it("renders pending users and calls approve()", async () => {
    const adm = await import("../../src/api/admin");
    const pending = [
      {
        id: "u1",
        email: "wait@x.com",
        github_login: "waituser",
        status: "pending" as const,
        role: "user" as const,
        created_at: "2026-05-27T00:00:00Z",
        approved_at: null,
        last_login_at: null,
      },
    ];
    (adm.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    (adm.approveUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pending[0],
      status: "approved",
    });

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/waituser/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(adm.approveUser).toHaveBeenCalledWith("u1"));
  });
});
