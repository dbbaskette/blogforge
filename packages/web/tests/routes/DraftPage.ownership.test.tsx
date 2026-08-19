import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Draft } from "../../src/api/drafts";
import type { DraftWorkspaceProps } from "../../src/components/draft/DraftWorkspace";
import { DraftPage } from "../../src/routes/DraftPage";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const api = vi.hoisted(() => ({
  expandSections: vi.fn(),
  generateOutline: vi.fn(),
  getActiveJob: vi.fn(),
  getDraft: vi.fn(),
  regenerateSection: vi.fn(),
  reorderSections: vi.fn(),
  revertSectionVersion: vi.fn(),
  reviseDraft: vi.fn(),
  saveSection: vi.fn(),
  setDraftStage: vi.fn(),
  updateDraft: vi.fn(),
}));

const workspace = vi.hoisted(() => ({ current: null as DraftWorkspaceProps | null }));

vi.mock("../../src/api/drafts", () => api);
vi.mock("../../src/components/draft/DraftWorkspace", () => ({
  DraftWorkspace: (props: DraftWorkspaceProps) => {
    workspace.current = props;
    return (
      <div>
        <span data-testid="workspace-draft">{props.draft.id}</span>
        <span data-testid="workspace-job">{props.jobId ?? "none"}</span>
      </div>
    );
  },
}));

function draft(id: string, title: string): Draft {
  return {
    id,
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
    title,
    stage: "sections",
    idea: { topic: title, pack_slug: "dan", provider: "anthropic", model: "model" },
    outline: {
      opening_hook: `${title} opening`,
      sections: [{ id: "s1", title: "First", brief: "Explain it" }],
      estimated_words: 400,
    },
    sections: [
      {
        id: "s1",
        title: "First",
        brief: "Explain it",
        content_md: `${title} prose.`,
        status: "ready",
        last_generated_at: null,
        last_error: null,
        word_count: 3,
      },
    ],
    tags: [],
    hero_image_key: null,
  };
}

function RouteSwitcher(): JSX.Element {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/drafts/draft-b")}>
      Open draft B
    </button>
  );
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/drafts/draft-a"]}>
      <RouteSwitcher />
      <Routes>
        <Route path="/drafts/:id" element={<DraftPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DraftPage async ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.current = null;
    api.getActiveJob.mockResolvedValue({ job_id: null });
    api.updateDraft.mockResolvedValue(undefined);
  });

  it("treats an accepted compose job as committed when only the refresh fails", async () => {
    const draftA = draft("draft-a", "Draft A");
    api.getDraft.mockResolvedValueOnce(draftA).mockRejectedValueOnce(new Error("refresh failed"));
    api.expandSections.mockResolvedValue({ job_id: "accepted-job" });
    renderPage();

    await waitFor(() => expect(workspace.current?.draft.id).toBe("draft-a"));
    let failure: unknown;
    await act(async () => {
      try {
        await workspace.current?.onExpandAll();
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeUndefined();
    expect(screen.getByTestId("workspace-job")).toHaveTextContent("accepted-job");
    expect(api.expandSections).toHaveBeenCalledTimes(1);
  });

  it("discards every late draft-A workflow completion after draft B owns the route", async () => {
    const draftA = draft("draft-a", "Draft A");
    const draftB = draft("draft-b", "Draft B");
    const staleDraft = draft("draft-a", "Late Draft A");
    const staleRefresh = deferred<Draft>();
    let loadedA = false;
    api.getDraft.mockImplementation((id: string) => {
      if (id === "draft-b") return Promise.resolve(draftB);
      if (!loadedA) {
        loadedA = true;
        return Promise.resolve(draftA);
      }
      return staleRefresh.promise;
    });

    const outline = deferred<Draft>();
    const expand = deferred<{ job_id: string }>();
    const remaining = deferred<{ job_id: string }>();
    const sectionSave = deferred<Draft>();
    const regenerate = deferred<{ job_id: string }>();
    const revert = deferred<Draft>();
    const revise = deferred<{ job_id: string }>();
    const stage = deferred<Draft>();
    const reorder = deferred<Draft>();
    api.generateOutline.mockReturnValue(outline.promise);
    api.expandSections.mockReturnValueOnce(expand.promise).mockReturnValueOnce(remaining.promise);
    api.saveSection.mockReturnValue(sectionSave.promise);
    api.regenerateSection.mockReturnValue(regenerate.promise);
    api.revertSectionVersion.mockReturnValue(revert.promise);
    api.reviseDraft.mockReturnValue(revise.promise);
    api.setDraftStage.mockReturnValue(stage.promise);
    api.reorderSections.mockReturnValue(reorder.promise);
    renderPage();

    await waitFor(() => expect(workspace.current?.draft.id).toBe("draft-a"));
    const ownerA = workspace.current as DraftWorkspaceProps;
    const operations = [
      ownerA.onGenerateOutline(),
      ownerA.onExpandAll(),
      ownerA.onExpandUnfilled(),
      ownerA.onSectionSave("s1", "Late save"),
      ownerA.onRegenerateSection("s1", "Late regenerate"),
      ownerA.onRevertSection("s1", "version-a"),
      ownerA.onReviseDraft("Late revise"),
      ownerA.onJumpStage("outline"),
      ownerA.onReorder(["s1"]),
    ];
    ownerA.onJobComplete();

    fireEvent.click(screen.getByRole("button", { name: "Open draft B" }));
    await waitFor(() => expect(screen.getByTestId("workspace-draft")).toHaveTextContent("draft-b"));

    outline.resolve(staleDraft);
    expand.resolve({ job_id: "expand-a" });
    remaining.resolve({ job_id: "remaining-a" });
    sectionSave.resolve(staleDraft);
    regenerate.resolve({ job_id: "regenerate-a" });
    revert.resolve(staleDraft);
    revise.resolve({ job_id: "revise-a" });
    stage.resolve(staleDraft);
    reorder.resolve(staleDraft);
    await act(async () => Promise.resolve());
    staleRefresh.resolve(staleDraft);
    await act(async () => {
      await Promise.all(operations);
    });

    expect(screen.getByTestId("workspace-draft")).toHaveTextContent("draft-b");
    expect(screen.getByTestId("workspace-job")).toHaveTextContent("none");
  });
});
