import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DraftsPage } from "../../src/routes/DraftsPage";

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "user", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../../src/api/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getMe: vi.fn().mockResolvedValue({
    id: "u1",
    email: "test@x.com",
    role: "user",
    status: "approved",
  }),
}));
vi.mock("../../src/api/drafts", () => ({
  listDrafts: vi.fn().mockResolvedValue([]),
  deleteDraft: vi.fn(),
}));
vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi
    .fn()
    .mockResolvedValue({ anthropic: true, openai: false, google: false }),
}));

describe("DraftsPage", () => {
  it("renders empty state", async () => {
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument());
  });
});
