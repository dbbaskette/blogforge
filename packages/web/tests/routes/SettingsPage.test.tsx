import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "../../src/routes/SettingsPage";

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "admin", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

describe("SettingsPage", () => {
  it("renders the account details for the current user", async () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: /account/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("test@x.com")).toBeInTheDocument());
    expect(screen.getByText("admin")).toBeInTheDocument();
  });
});
