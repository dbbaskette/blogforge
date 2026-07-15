import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as providers from "../../src/api/providers";
import { DefaultProviderCard } from "../../src/components/settings/DefaultProviderCard";

beforeEach(() => localStorage.clear());

function mockLoad(defaultProvider: providers.Provider = "anthropic") {
  vi.spyOn(providers, "getDefaultProvider").mockResolvedValue({
    default_provider: defaultProvider,
  });
  vi.spyOn(providers, "listProviderAvailability").mockResolvedValue({
    anthropic: true,
    openai: true,
    google: true,
    "claude-cli": true,
    "codex-cli": true,
    tanzu: true,
  });
}

describe("DefaultProviderCard", () => {
  it("loads the server default and shows exactly one of all six providers checked", async () => {
    mockLoad("google");
    render(<DefaultProviderCard />);
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(radios.filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Google API" })).toBeChecked();
  });

  it("keeps unavailable providers visible, disabled, and explained", async () => {
    mockLoad();
    vi.mocked(providers.listProviderAvailability).mockResolvedValue({
      anthropic: true,
      openai: false,
      google: true,
      "claude-cli": true,
      "codex-cli": true,
      tanzu: true,
    });
    render(<DefaultProviderCard />);
    const openai = await screen.findByRole("radio", { name: /OpenAI API/ });
    expect(openai).toBeDisabled();
    expect(screen.getByText(/OpenAI API.*unavailable/i)).toBeInTheDocument();
  });

  it("saves the selected server default without mutating compose defaults", async () => {
    mockLoad();
    const save = vi
      .spyOn(providers, "setDefaultProvider")
      .mockResolvedValue({ default_provider: "codex-cli" });
    localStorage.setItem(
      "bf.compose.defaults",
      JSON.stringify({ provider: "anthropic", model: "x" }),
    );
    const before = localStorage.getItem("bf.compose.defaults");
    render(<DefaultProviderCard />);
    fireEvent.click(await screen.findByRole("radio", { name: "Codex CLI (subscription)" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("codex-cli"));
    expect(localStorage.getItem("bf.compose.defaults")).toBe(before);
  });

  it("restores the prior selection and reports a save failure", async () => {
    mockLoad("anthropic");
    vi.spyOn(providers, "setDefaultProvider").mockRejectedValue(new Error("save failed"));
    render(<DefaultProviderCard />);
    fireEvent.click(await screen.findByRole("radio", { name: "Codex CLI (subscription)" }));
    expect(await screen.findByText("save failed")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Anthropic API" })).toBeChecked();
  });
});
