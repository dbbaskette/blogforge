import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/ideation", () => ({
  listIdeation: vi.fn().mockResolvedValue([]),
  postIdeationMessage: vi.fn(),
  acceptIdeation: vi.fn(),
}));
vi.mock("../../src/api/references", () => ({ listReferences: vi.fn().mockResolvedValue([]) }));
vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
  listFormats: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([]),
}));

import type { Draft } from "../../src/api/drafts";
import { listModels } from "../../src/api/providers";
import {
  DraftWorkspace,
  type DraftWorkspaceProps,
} from "../../src/components/draft/DraftWorkspace";

const readySection = {
  id: "s1",
  title: "Kept section",
  brief: "Already complete",
  content_md: "Completed prose stays here.",
  status: "ready" as const,
  last_generated_at: null,
  last_error: null,
  word_count: 4,
};

function makeDraft(secondStatus: "empty" | "failed" | "ready" = "failed"): Draft {
  return {
    id: "next-action-draft",
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
    title: "Next action draft",
    stage: "sections",
    idea: { topic: "Next action draft", pack_slug: "dan", provider: "anthropic", model: "model" },
    outline: {
      opening_hook: "",
      sections: [
        { id: "s1", title: "Kept section", brief: "Already complete" },
        { id: "s2", title: "Remaining section", brief: "Still needed" },
      ],
      estimated_words: 800,
    },
    sections: [
      readySection,
      {
        id: "s2",
        title: "Remaining section",
        brief: "Still needed",
        content_md: secondStatus === "ready" ? "Finished prose." : "",
        status: secondStatus,
        last_generated_at: null,
        last_error: secondStatus === "failed" ? "Previous failure" : null,
        word_count: secondStatus === "ready" ? 2 : 0,
      },
    ],
    tags: [],
    hero_image_key: null,
  };
}

function props(draft: Draft, overrides: Partial<DraftWorkspaceProps> = {}): DraftWorkspaceProps {
  return {
    draft,
    jobId: null,
    saving: false,
    saveError: null,
    onChange: vi.fn().mockResolvedValue(undefined),
    onGenerateOutline: vi.fn().mockResolvedValue(undefined),
    onExpandAll: vi.fn().mockResolvedValue(undefined),
    onExpandUnfilled: vi.fn().mockResolvedValue(undefined),
    onSectionSave: vi.fn().mockResolvedValue(undefined),
    onRegenerateSection: vi.fn().mockResolvedValue(undefined),
    onRevertSection: vi.fn().mockResolvedValue(undefined),
    onReviseDraft: vi.fn().mockResolvedValue(undefined),
    onJumpStage: vi.fn().mockResolvedValue(undefined),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onJobComplete: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(workspaceProps: DraftWorkspaceProps): void {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DraftWorkspace {...workspaceProps} />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("DraftWorkspace next actions", () => {
  it.each([
    ["failed", "Retry remaining sections"],
    ["empty", "Finish remaining sections"],
  ] as const)("routes a %s section through remaining-only compose", async (status, label) => {
    const onExpandAll = vi.fn().mockResolvedValue(undefined);
    const onExpandUnfilled = vi.fn().mockResolvedValue(undefined);
    renderWorkspace(props(makeDraft(status), { onExpandAll, onExpandUnfilled }));

    expect(await screen.findByText("Completed prose stays here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(onExpandUnfilled).toHaveBeenCalledOnce());
    expect(onExpandAll).not.toHaveBeenCalled();
  });

  it("recovers from a rejected remaining request without hiding completed work", async () => {
    const onExpandUnfilled = vi.fn().mockRejectedValue(new Error("POST failed"));
    renderWorkspace(props(makeDraft("failed"), { onExpandUnfilled }));

    fireEvent.click(screen.getByRole("button", { name: "Retry remaining sections" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your work is still here");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry remaining sections" })).toBeEnabled(),
    );
    expect(await screen.findByText("Completed prose stays here.")).toBeInTheDocument();
  });

  it("recovers from a rejected full compose request", async () => {
    const outlined = makeDraft("empty");
    outlined.stage = "outline";
    const onExpandAll = vi.fn().mockRejectedValue(new Error("POST failed"));
    const onExpandUnfilled = vi.fn().mockResolvedValue(undefined);
    renderWorkspace(props(outlined, { onExpandAll, onExpandUnfilled }));

    fireEvent.click(screen.getByRole("button", { name: "Compose draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your work is still here");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Compose draft" })).toBeEnabled(),
    );
    expect(onExpandAll).toHaveBeenCalledOnce();
    expect(onExpandUnfilled).not.toHaveBeenCalled();
  });

  it("opens and focuses the real Setup disclosure from a missing-model blocker", async () => {
    const research = makeDraft("empty");
    research.stage = "research";
    research.idea.model = "";
    research.outline = null;
    research.sections = [];
    renderWorkspace(props(research));

    const setupToggle = document.getElementById("draft-setup-toggle") as HTMLButtonElement;
    fireEvent.click(setupToggle);
    expect(setupToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("link", { name: "Open Setup" }));

    expect(setupToggle).toHaveAttribute("aria-expanded", "true");
    expect(setupToggle).toHaveFocus();
    await waitFor(() => expect(listModels).toHaveBeenCalledWith("anthropic"));
    expect(await screen.findByText(/No references yet/i)).toBeInTheDocument();
  });

  it("jumps to Outline when a complete draft has outline drift", async () => {
    const stale = makeDraft("ready");
    if (stale.outline) stale.outline.sections[0].title = "Old title";
    const onJumpStage = vi.fn().mockResolvedValue(undefined);
    renderWorkspace(props(stale, { onJumpStage }));

    fireEvent.click(screen.getByRole("button", { name: "Review outline" }));

    await waitFor(() => expect(onJumpStage).toHaveBeenCalledWith("outline"));
  });
});
