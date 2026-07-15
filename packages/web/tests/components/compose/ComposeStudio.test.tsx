import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  listFormats: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([{ id: "m1", label: "Model One" }]),
  getDefaultProvider: vi.fn().mockResolvedValue({ default_provider: null }),
}));

import {
  createDraft,
  expandSections,
  generateOutline,
  importDraft,
  updateDraft,
} from "../../../src/api/drafts";
import { getDefaultProvider, listProviderAvailability } from "../../../src/api/providers";
import { listModels } from "../../../src/api/providers";
import { listTemplates } from "../../../src/api/templates";
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
    vi.mocked(getDefaultProvider).mockResolvedValue({ default_provider: null });
    vi.mocked(listProviderAvailability).mockResolvedValue({ anthropic: true });
    vi.mocked(listTemplates).mockResolvedValue([]);
    vi.mocked(listModels).mockResolvedValue([
      {
        id: "m1",
        label: "Model One",
        context_window: 100_000,
        supports_streaming: true,
        input_per_million_usd: null,
        output_per_million_usd: null,
      },
    ]);
  });

  it("uses the server preference instead of a stale browser provider", async () => {
    localStorage.setItem(
      "bf.compose.defaults",
      JSON.stringify({ provider: "claude-cli", model: "stale-model" }),
    );
    vi.mocked(getDefaultProvider).mockResolvedValue({ default_provider: "codex-cli" });
    vi.mocked(listProviderAvailability).mockResolvedValue({
      anthropic: true,
      "claude-cli": true,
      "codex-cli": true,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /^▼ Advanced$/i }));

    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("codex-cli"));
  });

  it("keeps an unavailable explicit server preference instead of availability auto-picking", async () => {
    vi.mocked(getDefaultProvider).mockResolvedValue({ default_provider: "codex-cli" });
    vi.mocked(listProviderAvailability).mockResolvedValue({
      anthropic: true,
      "codex-cli": false,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));

    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("codex-cli"));
    await waitFor(() =>
      expect(screen.getByText("Codex CLI is not installed.")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Provider")).toHaveValue("codex-cli");
  });

  it("keeps availability auto-pick when the server has no preference", async () => {
    vi.mocked(listProviderAvailability).mockResolvedValue({ anthropic: true });
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));

    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("anthropic"));
  });

  it("does not overwrite a template provider and model when preference resolution is late", async () => {
    let resolvePreference!: (value: { default_provider: "codex-cli" }) => void;
    vi.mocked(getDefaultProvider).mockReturnValue(
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
    );
    vi.mocked(listTemplates).mockResolvedValue([
      {
        id: "t1",
        name: "OpenAI launch",
        topic: "Launch topic",
        pack_slug: "house",
        provider: "openai",
        model: "template-model",
        target_words: 900,
        format: null,
        bullets: [],
        notes: "",
        created_at: "2026-07-15T00:00:00Z",
        updated_at: "2026-07-15T00:00:00Z",
      },
    ]);
    vi.mocked(listProviderAvailability).mockResolvedValue({
      openai: true,
      "codex-cli": true,
    });
    vi.mocked(listModels).mockResolvedValue([
      {
        id: "template-model",
        label: "Template model",
        context_window: 100_000,
        supports_streaming: true,
        input_per_million_usd: null,
        output_per_million_usd: null,
      },
    ]);

    renderStudio();
    fireEvent.click(await screen.findByRole("button", { name: "OpenAI launch" }));
    fireEvent.click(screen.getByRole("button", { name: /^▼ Advanced$/i }));
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("openai"));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("template-model"));

    await act(async () => resolvePreference({ default_provider: "codex-cli" }));
    expect(screen.getByLabelText("Provider")).toHaveValue("openai");
    expect(screen.getByLabelText("Model")).toHaveValue("template-model");
  });

  it("gates draft submission until the server preference resolves", async () => {
    let resolvePreference!: (value: { default_provider: "codex-cli" }) => void;
    vi.mocked(getDefaultProvider).mockReturnValue(
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
    );
    vi.mocked(listProviderAvailability).mockResolvedValue({
      anthropic: true,
      "codex-cli": true,
    });

    renderStudio();
    fireEvent.click(screen.getByText(/Blank page/));
    const button = screen.getByRole("button", { name: /open editor/i });
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("claude-cli"));
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createDraft).not.toHaveBeenCalled();

    await act(async () => resolvePreference({ default_provider: "codex-cli" }));
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("codex-cli"));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("does not overwrite a manual provider selection when preference resolution is late", async () => {
    let resolvePreference!: (value: { default_provider: "codex-cli" }) => void;
    vi.mocked(getDefaultProvider).mockReturnValue(
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
    );
    vi.mocked(listProviderAvailability).mockResolvedValue({
      anthropic: true,
      openai: true,
      "codex-cli": true,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("claude-cli"));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("openai"));

    await act(async () => resolvePreference({ default_provider: "codex-cli" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("m1"));
    expect(screen.getByLabelText("Provider")).toHaveValue("openai");
  });

  it("falls back to an available provider when preference loading fails", async () => {
    localStorage.setItem(
      "bf.compose.defaults",
      JSON.stringify({ provider: "claude-cli", model: "stale-model" }),
    );
    vi.mocked(getDefaultProvider).mockRejectedValue(new Error("preference unavailable"));
    vi.mocked(listProviderAvailability).mockResolvedValue({
      anthropic: true,
      "claude-cli": false,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));

    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("anthropic"));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("m1"));
  });

  it("allows a provider change within the new draft session and submits it", async () => {
    vi.mocked(listProviderAvailability).mockResolvedValue({ anthropic: true, openai: true });
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("anthropic"));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("m1"));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("openai"));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("m1"));
    fireEvent.click(screen.getByText(/Blank page/));
    const btn = screen.getByRole("button", { name: /open editor/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    await waitFor(() =>
      expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai" })),
    );
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

  it("Paste mode imports a draft and lands in the editor verbatim (no auto-run)", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/I already wrote it/));
    fireEvent.change(screen.getByLabelText(/paste your draft/i), {
      target: { value: "# Title\n\n## One\n\nBody." },
    });
    const btn = screen.getByRole("button", { name: /import →/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(importDraft).toHaveBeenCalled());
    // No ?shape=1 — import must not auto-run any shaping/analysis pass.
    expect(navigate).toHaveBeenCalledWith("/drafts/d9");
  });
});
