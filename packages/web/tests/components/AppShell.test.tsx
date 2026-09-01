import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "../../src/components/AppShell";

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: {
      id: "u1",
      email: "test@x.com",
      github_login: "tester",
      role: "user",
      status: "approved",
    },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../../src/hooks/useVersionCheck", () => ({
  useVersionCheck: () => ({ stale: false }),
}));
vi.mock("../../src/components/CommandPalette", () => ({
  CommandPalette: () => <div>command-palette</div>,
}));

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <AppShell />
    </MemoryRouter>,
  );
}

describe("AppShell top bar", () => {
  it("offers a search button that opens the command palette", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /search drafts and navigate/i }));
    expect(screen.getByText("command-palette")).toBeInTheDocument();
  });

  it("opens the mobile menu with all primary destinations", () => {
    renderShell();
    expect(screen.queryByRole("navigation", { name: /main navigation/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    const menu = screen.getByRole("navigation", { name: /main navigation/i });
    expect(menu).toBeInTheDocument();
    for (const label of ["Drafts", "Your Voice", "Help", "Settings"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
    // The menu exposes sign-out too.
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });

  it("closes the mobile menu on Escape", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: /main navigation/i })).not.toBeInTheDocument();
  });

  it("hides admin links for non-admin users", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });
});
