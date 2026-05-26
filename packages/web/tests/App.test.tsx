import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

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
  it("renders the scaffold header", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("Pencraft")).toBeInTheDocument();
  });
});
