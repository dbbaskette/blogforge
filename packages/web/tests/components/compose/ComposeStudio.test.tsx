import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("../../../src/api/drafts", () => ({
  createDraft: vi.fn().mockResolvedValue({ id: "d1" }),
}));
vi.mock("../../../src/api/templates", () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  deleteTemplate: vi.fn(),
}));
vi.mock("../../../src/api/voice", () => ({ getVoiceProfile: vi.fn().mockResolvedValue({ name: "Dan" }) }));
vi.mock("../../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([{ slug: "house", valid: true }]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));
vi.mock("../../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([{ id: "m1", label: "Model One" }]),
}));

import { createDraft } from "../../../src/api/drafts";
import { ComposeStudio } from "../../../src/components/compose/ComposeStudio";

const renderStudio = () => render(<MemoryRouter><ComposeStudio /></MemoryRouter>);

describe("ComposeStudio", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it("shows the four modes", () => {
    renderStudio();
    expect(screen.getByText(/I have an outline/)).toBeInTheDocument();
    expect(screen.getByText(/Help me shape it/)).toBeInTheDocument();
    expect(screen.getByText(/Just write it/)).toBeInTheDocument();
    expect(screen.getByText(/Blank page/)).toBeInTheDocument();
  });

  it("Blank mode creates a draft and navigates to the editor", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Blank page/));
    fireEvent.click(screen.getByRole("button", { name: /open editor/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/drafts/d1");
  });
});
