import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/keys", () => ({
  getKeyStatus: vi.fn().mockResolvedValue({ anthropic: true, openai: false, google: false }),
  setKey: vi.fn(),
  deleteKey: vi.fn(),
}));

import { ProviderKeysCard } from "../../../src/components/settings/ProviderKeysCard";

describe("ProviderKeysCard", () => {
  it("renders all three provider labels", async () => {
    render(<ProviderKeysCard />);
    await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google (Gemini)")).toBeInTheDocument();
  });

  it("shows Set ✓ for a configured provider and Not set for unconfigured", async () => {
    render(<ProviderKeysCard />);
    await waitFor(() => expect(screen.getByText(/Set ✓/)).toBeInTheDocument());
    expect(screen.getAllByText("Not set").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a Clear button only for the set provider", async () => {
    render(<ProviderKeysCard />);
    await waitFor(() => expect(screen.getByText(/Set ✓/)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /clear/i }).length).toBe(1);
  });

  it("renders the Google hero-images note", async () => {
    render(<ProviderKeysCard />);
    await waitFor(() =>
      expect(screen.getByText(/Required for hero images/i)).toBeInTheDocument(),
    );
  });
});
