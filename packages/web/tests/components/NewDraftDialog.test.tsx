import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { NewDraftDialog } from "../../src/components/NewDraftDialog";

vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([
    {
      slug: "dan",
      name: "Dan",
      version: "1.0",
      valid: true,
      error_count: 0,
      description: "Punchy, technical, opinionated essays.",
      one_line: "Writes like a skeptical staff engineer.",
    },
    {
      slug: "plain",
      name: "Plain",
      version: "1.0",
      valid: true,
      error_count: 0,
      description: "",
      one_line: "",
    },
  ]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));

vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: false }),
  listModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/api/drafts", () => ({
  createDraft: vi.fn(),
}));

describe("NewDraftDialog", () => {
  it("renders the selected pack's voice preview", async () => {
    render(
      <MemoryRouter>
        <NewDraftDialog open onClose={() => {}} />
      </MemoryRouter>,
    );

    // Wait for packs to load, then select one with a description + one_line.
    await waitFor(() => expect(screen.getByRole("option", { name: "dan" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/voice pack/i), { target: { value: "dan" } });

    await waitFor(() =>
      expect(screen.getByText(/punchy, technical, opinionated essays/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/skeptical staff engineer/i)).toBeInTheDocument();
  });

  it("renders no preview for a pack with empty description and one_line", async () => {
    render(
      <MemoryRouter>
        <NewDraftDialog open onClose={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("option", { name: "plain" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/voice pack/i), { target: { value: "plain" } });

    // No preview text and no crash.
    expect(screen.queryByText(/punchy/i)).not.toBeInTheDocument();
  });
});
