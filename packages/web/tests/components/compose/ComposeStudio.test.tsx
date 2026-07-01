import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("../../../src/api/drafts", () => ({
  createDraft: vi.fn().mockResolvedValue({
    id: "d1",
    title: "",
    stage: "research",
    idea: {},
    sections: [],
    outline: null,
  }),
  updateDraft: vi.fn().mockResolvedValue({}),
  expandSections: vi.fn().mockResolvedValue({ job_id: "j1" }),
  generateOutline: vi.fn().mockResolvedValue({}),
  importDraft: vi.fn().mockResolvedValue({ id: "d9" }),
}));
vi.mock("../../../src/api/templates", () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  deleteTemplate: vi.fn(),
}));
vi.mock("../../../src/api/voice", () => ({
  getVoiceProfile: vi.fn().mockResolvedValue({ name: "Dan" }),
}));
vi.mock("../../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([{ slug: "house", valid: true }]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));
vi.mock("../../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([{ id: "m1", label: "Model One" }]),
}));

import {
  createDraft,
  expandSections,
  generateOutline,
  importDraft,
  updateDraft,
} from "../../../src/api/drafts";
import { ComposeStudio } from "../../../src/components/compose/ComposeStudio";

const renderStudio = () =>
  render(
    <MemoryRouter>
      <ComposeStudio />
    </MemoryRouter>,
  );

describe("ComposeStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the four modes", () => {
    renderStudio();
    expect(screen.getByText(/I have an outline/)).toBeInTheDocument();
    expect(screen.getByText(/Help me shape it/)).toBeInTheDocument();
    expect(screen.getByText(/Just write it/)).toBeInTheDocument();
    expect(screen.getByText(/Blank page/)).toBeInTheDocument();
  });

  it("badges the fastest mode and shows starters when no templates are saved", () => {
    renderStudio();
    expect(screen.getByText(/Fastest/i)).toBeInTheDocument();
    expect(screen.getByText(/not sure where to start/i)).toBeInTheDocument();
    expect(screen.getByText(/How-to guide/i)).toBeInTheDocument();
  });

  it("surfaces the setup summary once a model resolves", async () => {
    renderStudio();
    await waitFor(() => expect(screen.getByText(/Writing in/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Edit$/i })).toBeInTheDocument();
  });

  // The pre-flight guard disables the run buttons until an available provider +
  // model resolve (async). Wait for the button to enable before clicking.
  it("Blank mode creates a draft and navigates to the editor", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Blank page/));
    const btn = screen.getByRole("button", { name: /open editor/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/drafts/d1");
  });

  it("Outline-in parses, injects outline, expands, navigates", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/I have an outline/));
    fireEvent.change(screen.getByLabelText(/your outline/i), {
      target: { value: "# T\n## One\n## Two" },
    });
    const btn = screen.getByRole("button", { name: /write draft/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(expandSections).toHaveBeenCalledWith("d1"));
    expect(createDraft).toHaveBeenCalled();
    expect(updateDraft).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({
        outline: expect.objectContaining({
          sections: expect.arrayContaining([expect.objectContaining({ title: "One" })]),
        }),
      }),
    );
    expect(navigate).toHaveBeenCalledWith("/drafts/d1");
  });

  it("Express creates, outlines, expands, navigates", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Just write it/));
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "My topic" } });
    const btn = screen.getByRole("button", { name: /outline & write/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(expandSections).toHaveBeenCalledWith("d1"));
    expect(generateOutline).toHaveBeenCalledWith("d1");
    expect(navigate).toHaveBeenCalledWith("/drafts/d1");
  });

  it("Propose creates and navigates to the editor", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Help me shape it/));
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "My topic" } });
    const btn = screen.getByRole("button", { name: /start →/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(generateOutline).toHaveBeenCalledWith("d1"));
    expect(navigate).toHaveBeenCalledWith("/drafts/d1");
  });

  it("Paste mode imports a draft and navigates to the editor with ?shape=1", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/I already wrote it/));
    fireEvent.change(screen.getByLabelText(/paste your draft/i), {
      target: { value: "# Title\n\n## One\n\nBody." },
    });
    const btn = screen.getByRole("button", { name: /import & shape/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(importDraft).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/drafts/d9?shape=1");
  });
});
