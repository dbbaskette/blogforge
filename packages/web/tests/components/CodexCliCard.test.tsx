import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as providers from "../../src/api/providers";
import { CodexCliCard } from "../../src/components/settings/CodexCliCard";

describe("CodexCliCard", () => {
  it("shows a checking state while probing", () => {
    vi.spyOn(providers, "getCodexCliStatus").mockReturnValue(new Promise(() => undefined));
    render(<CodexCliCard />);
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
  });

  it("reports authenticated status", async () => {
    vi.spyOn(providers, "getCodexCliStatus").mockResolvedValue({
      installed: true,
      authenticated: true,
      detail: "Codex is ready.",
      resolve: "",
    });
    render(<CodexCliCard />);
    expect(await screen.findByText(/logged in ✓/)).toBeInTheDocument();
  });

  it("reports unauthenticated status with API recovery guidance", async () => {
    vi.spyOn(providers, "getCodexCliStatus").mockResolvedValue({
      installed: true,
      authenticated: false,
      detail: "Codex is not logged in.",
      resolve: "Run `codex login`, then Refresh.",
    });
    render(<CodexCliCard />);
    expect(await screen.findByText("Installed · not logged in")).toBeInTheDocument();
    expect(screen.getByText(/codex login/)).toBeInTheDocument();
  });

  it("reports a missing CLI and can refresh", async () => {
    const probe = vi.spyOn(providers, "getCodexCliStatus").mockResolvedValue({
      installed: false,
      authenticated: false,
      detail: "Codex is not installed.",
      resolve: "Install the codex binary.",
    });
    render(<CodexCliCard />);
    expect(await screen.findByText("Not installed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });
});
