import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as providers from "../../src/api/providers";
import { ClaudeCliCard } from "../../src/components/settings/ClaudeCliCard";

describe("ClaudeCliCard", () => {
  it("reports logged-in status from the probe", async () => {
    vi.spyOn(providers, "getClaudeCliStatus").mockResolvedValue({
      installed: true,
      authenticated: true,
      detail: "The Claude CLI is installed and logged in.",
      resolve: "",
    });
    render(<ClaudeCliCard />);
    await waitFor(() => expect(screen.getByText(/logged in ✓/)).toBeInTheDocument());
  });

  it("reports not-logged-in with the claude /login fix", async () => {
    vi.spyOn(providers, "getClaudeCliStatus").mockResolvedValue({
      installed: true,
      authenticated: false,
      detail: "The Claude CLI is installed but not logged in.",
      resolve: "Run `claude /login` in the terminal where BlogForge runs, then Refresh.",
    });
    render(<ClaudeCliCard />);
    await waitFor(() => expect(screen.getByText("Installed · not logged in")).toBeInTheDocument());
    expect(screen.getByText(/claude \/login/)).toBeInTheDocument();
  });

  it("contains status refresh but no browser-local default checkbox", async () => {
    const probe = vi.spyOn(providers, "getClaudeCliStatus").mockResolvedValue({
      installed: true,
      authenticated: true,
      detail: "ok",
      resolve: "",
    });
    render(<ClaudeCliCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
