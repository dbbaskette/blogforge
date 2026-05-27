import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

vi.mock("../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "user", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

vi.mock("../src/api/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getMe: vi.fn().mockResolvedValue({
    id: "u1",
    email: "test@x.com",
    role: "user",
    status: "approved",
  }),
}));

vi.mock("../src/api/drafts", () => ({
  listDrafts: vi.fn().mockResolvedValue([]),
  deleteDraft: vi.fn(),
}));
vi.mock("../src/api/providers", () => ({
  listProviderAvailability: vi
    .fn()
    .mockResolvedValue({ anthropic: false, openai: false, google: false }),
}));

describe("App", () => {
  it("renders the masthead wordmark", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    // Two "Pencraft" elements appear (masthead + colophon) — either is fine.
    expect(screen.getAllByText("Pencraft").length).toBeGreaterThan(0);
  });
});
