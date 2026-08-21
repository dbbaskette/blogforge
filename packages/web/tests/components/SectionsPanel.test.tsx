import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiError } from "../../src/api/client";
import type { Draft } from "../../src/api/drafts";
import { SectionsPanel } from "../../src/components/draft/SectionsPanel";

vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi
    .fn()
    .mockResolvedValue({ anthropic: true, openai: true, google: false }),
  listModels: vi.fn().mockResolvedValue([
    {
      id: "m1",
      label: "Model One",
      context_window: 200_000,
      supports_streaming: true,
      input_per_million_usd: null,
      output_per_million_usd: null,
    },
  ]),
}));

function makeDraft(): Draft {
  return {
    id: "d1",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    title: "My Essay",
    stage: "sections",
    idea: { topic: "My Essay", pack_slug: "dan", provider: "anthropic", model: "m" },
    outline: { opening_hook: "A hook.", sections: [], estimated_words: 0 },
    sections: [
      {
        id: "s1",
        title: "First Section",
        brief: "",
        content_md: "The first section prose.",
        status: "ready",
        last_generated_at: null,
        last_error: null,
        word_count: 4,
      },
    ],
    tags: [],
    hero_image_key: null,
  };
}

const noop = async (): Promise<void> => {};

const baseProps = {
  generatingIds: new Set<string>(),
  jobError: null,
  onDismissJobError: () => {},
  unfilledCount: 0,
  jobRunning: false,
  onSectionSave: noop,
  onRegenerateSection: noop,
  onRevertSection: noop,
  onReorder: noop,
  onReviseDraft: noop,
};

describe("SectionsPanel", () => {
  it("switches to a continuous read view", () => {
    render(<SectionsPanel {...baseProps} draft={makeDraft()} onReviseDraft={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /^read$/i }));
    // The assembled read view renders the title as a heading.
    expect(screen.getByRole("heading", { name: /my essay/i })).toBeInTheDocument();
    expect(screen.getByText(/the first section prose/i)).toBeInTheDocument();
  });

  it("leaves draft progression to the workspace next action", () => {
    render(
      <SectionsPanel {...baseProps} draft={makeDraft()} unfilledCount={5} onReviseDraft={noop} />,
    );
    expect(screen.getByText(/5 sections unwritten/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compose draft/i })).not.toBeInTheDocument();
  });

  it("keeps completed sections and links Settings after a provider generation failure", () => {
    const providerError = Object.assign(new Error("Provider stopped responding"), {
      status: 502,
      code: "provider_rejected_request",
      detail: { upstream: "rejected" },
    }) as ApiError;
    render(
      <SectionsPanel
        {...baseProps}
        draft={makeDraft()}
        unfilledCount={1}
        jobError={providerError}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Check your AI provider");
    expect(screen.getByText(/the first section prose/i)).toBeInTheDocument();
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("Provider stopped responding");
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByRole("button", { name: /compose remaining/i })).not.toBeInTheDocument();
  });

  it("shows one unified composing state (not per-section) during a single-pass compose", () => {
    render(
      <SectionsPanel
        {...baseProps}
        draft={makeDraft()}
        jobRunning
        composingWholeDraft
        onReviseDraft={noop}
      />,
    );
    // The compose "theater" shows one unified writing state.
    expect(screen.getByText(/writing in your voice/i)).toBeInTheDocument();
    // The per-section editor is suppressed during the whole-draft compose.
    expect(screen.queryByText(/the first section prose/i)).not.toBeInTheDocument();
  });

  it("submits a holistic revision instruction", async () => {
    const onReviseDraft = vi.fn(async (): Promise<void> => {});
    render(<SectionsPanel {...baseProps} draft={makeDraft()} onReviseDraft={onReviseDraft} />);

    fireEvent.click(screen.getByRole("button", { name: /revise whole draft/i }));
    fireEvent.change(screen.getByLabelText(/revise the whole draft/i), {
      target: { value: "smooth the transitions" },
    });
    fireEvent.click(screen.getByRole("button", { name: /revise 1 section/i }));

    await waitFor(() => expect(onReviseDraft).toHaveBeenCalledWith("smooth the transitions"));
  });

  it("keeps completed sections and retries a failed whole-draft revision", async () => {
    const onReviseDraft = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("gateway payload"), { status: 503 }))
      .mockResolvedValueOnce(undefined);
    render(<SectionsPanel {...baseProps} draft={makeDraft()} onReviseDraft={onReviseDraft} />);

    fireEvent.click(screen.getByRole("button", { name: /revise whole draft/i }));
    fireEvent.change(screen.getByLabelText(/revise the whole draft/i), {
      target: { value: "smooth the transitions" },
    });
    fireEvent.click(screen.getByRole("button", { name: /revise 1 section/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The service is unavailable");
    expect(screen.getByText(/the first section prose/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onReviseDraft).toHaveBeenCalledTimes(2));
    expect(onReviseDraft).toHaveBeenLastCalledWith("smooth the transitions");
  });

  it("retries the exact failed whole-draft note after the textarea changes", async () => {
    const onReviseDraft = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("gateway payload"), { status: 503 }))
      .mockResolvedValueOnce(undefined);
    render(<SectionsPanel {...baseProps} draft={makeDraft()} onReviseDraft={onReviseDraft} />);

    fireEvent.click(screen.getByRole("button", { name: /revise whole draft/i }));
    const note = screen.getByLabelText(/revise the whole draft/i);
    fireEvent.change(note, { target: { value: "smooth the transitions" } });
    fireEvent.click(screen.getByRole("button", { name: /revise 1 section/i }));
    await screen.findByRole("alert");
    fireEvent.change(note, { target: { value: "replace every example" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onReviseDraft).toHaveBeenCalledTimes(2));
    expect(onReviseDraft).toHaveBeenLastCalledWith("smooth the transitions");
  });

  it("rolls back and retries a failed section reorder", async () => {
    const draft = makeDraft();
    draft.sections.push({
      id: "s2",
      title: "Second Section",
      brief: "",
      content_md: "The second section prose.",
      status: "ready",
      last_generated_at: null,
      last_error: null,
      word_count: 4,
    });
    const onReorder = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("database response"), { status: 503 }))
      .mockResolvedValueOnce(undefined);
    render(<SectionsPanel {...baseProps} draft={draft} onReorder={onReorder} />);

    fireEvent.click(screen.getByRole("button", { name: "Move section down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The service is unavailable");
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("First Section");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(2));
    expect(onReorder).toHaveBeenLastCalledWith(["s2", "s1"]);
  });

  it("replays the exact failed section order after the server order changes", async () => {
    const draft = makeDraft();
    draft.sections.push({
      id: "s2",
      title: "Second Section",
      brief: "",
      content_md: "Second prose.",
      status: "ready",
      last_generated_at: null,
      last_error: null,
      word_count: 2,
    });
    draft.sections.push({
      id: "s3",
      title: "Third Section",
      brief: "",
      content_md: "Third prose.",
      status: "ready",
      last_generated_at: null,
      last_error: null,
      word_count: 2,
    });
    const onReorder = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("database response"), { status: 503 }))
      .mockResolvedValueOnce(undefined);
    const { rerender } = render(
      <SectionsPanel {...baseProps} draft={draft} onReorder={onReorder} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Move section down" })[0]);
    await screen.findByRole("alert");
    const serverChanged = {
      ...draft,
      sections: [draft.sections[2], draft.sections[0], draft.sections[1]],
    };
    rerender(<SectionsPanel {...baseProps} draft={serverChanged} onReorder={onReorder} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(2));
    expect(onReorder).toHaveBeenLastCalledWith(["s2", "s1", "s3"]);
  });

  it("reorders via drag-and-drop from the grip handle", async () => {
    const draft2 = makeDraft();
    draft2.sections = [
      { ...draft2.sections[0], id: "s1", title: "First Section" },
      { ...draft2.sections[0], id: "s2", title: "Second Section" },
      { ...draft2.sections[0], id: "s3", title: "Third Section" },
    ];
    const onReorder = vi.fn(async (): Promise<void> => {});
    render(
      <SectionsPanel {...baseProps} draft={draft2} onReorder={onReorder} onReviseDraft={noop} />,
    );

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    };
    // Drag the first section's grip onto the third card.
    fireEvent.dragStart(screen.getByRole("button", { name: /drag to reorder first section/i }), {
      dataTransfer,
    });
    const thirdCard = screen.getByText("Third Section").closest("div[class*='rounded']")!;
    fireEvent.dragOver(thirdCard, { dataTransfer });
    fireEvent.drop(thirdCard, { dataTransfer });

    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(["s2", "s3", "s1"]));
  });

  it("retries a failed compose with a different provider/model", async () => {
    const onUpdateIdea = vi.fn(async (): Promise<void> => {});
    const onComposeRemaining = vi.fn(async (): Promise<void> => {});
    render(
      <SectionsPanel
        {...baseProps}
        draft={makeDraft()}
        jobError={new Error("rate limited")}
        unfilledCount={3}
        onReviseDraft={noop}
        onUpdateIdea={onUpdateIdea}
        onComposeRemaining={onComposeRemaining}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /try another model/i }));
    const providerSelect = await screen.findByLabelText(/provider for retry/i);
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    const modelSelect = await screen.findByLabelText(/model for retry/i);
    await waitFor(() => expect(modelSelect).not.toBeDisabled());
    fireEvent.change(modelSelect, { target: { value: "m1" } });
    fireEvent.click(screen.getByRole("button", { name: /compose with this model/i }));

    await waitFor(() =>
      expect(onUpdateIdea).toHaveBeenCalledWith({ provider: "openai", model: "m1" }),
    );
    expect(onComposeRemaining).toHaveBeenCalledTimes(1);
  });

  it("shows a Stop control while composing", () => {
    const onCancelJob = vi.fn();
    render(
      <SectionsPanel
        {...baseProps}
        draft={makeDraft()}
        jobRunning
        composingWholeDraft
        onReviseDraft={noop}
        onCancelJob={onCancelJob}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onCancelJob).toHaveBeenCalledTimes(1);
  });
});
