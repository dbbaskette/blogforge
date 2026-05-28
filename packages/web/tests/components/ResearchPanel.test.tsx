import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Draft } from "../../src/api/drafts";
import { ResearchPanel } from "../../src/components/draft/ResearchPanel";

vi.mock("../../src/api/ideation", () => ({
  listIdeation: vi.fn(),
  postIdeationMessage: vi.fn(),
  acceptIdeation: vi.fn(),
}));

vi.mock("../../src/api/references", () => ({
  listReferences: vi.fn().mockResolvedValue([]),
  deleteReference: vi.fn(),
  addUrlReference: vi.fn(),
  addTextReference: vi.fn(),
  addFileReference: vi.fn(),
}));

vi.mock("../../src/hooks/useStreamJob", () => ({
  useStreamJob: vi.fn(),
}));

const draft: Draft = {
  id: "d1",
  created_at: "2026-05-28T00:00:00Z",
  updated_at: "2026-05-28T00:00:00Z",
  title: "Test",
  stage: "research",
  idea: {
    topic: "Test",
    pack_slug: "dan",
    provider: "anthropic",
    model: "claude-sonnet-4",
    target_words: 1500,
  },
  outline: null,
  sections: [],
};

const sampleOutline = {
  opening_hook: "Once upon a time…",
  sections: [
    { id: "s1", title: "First", brief: "Set the stage" },
    { id: "s2", title: "Second", brief: "Develop the angle" },
  ],
  estimated_words: 1500,
};

describe("ResearchPanel", () => {
  it("renders chat history and the seed prompt input", async () => {
    const ide = await import("../../src/api/ideation");
    (ide.listIdeation as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        position: 0,
        role: "user",
        content: "Hi there",
        proposed_outline: null,
        timestamp: "2026-05-28T00:00:00Z",
      },
      {
        id: "m2",
        position: 1,
        role: "assistant",
        content: "Hello!",
        proposed_outline: null,
        timestamp: "2026-05-28T00:00:01Z",
      },
    ]);

    render(<ResearchPanel draft={draft} onJobComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Hi there")).toBeInTheDocument());
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByLabelText(/Message Pencraft/i)).toBeInTheDocument();
  });

  it("posts an ideation message on Send", async () => {
    const ide = await import("../../src/api/ideation");
    (ide.listIdeation as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (ide.postIdeationMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ job_id: "j1" });

    render(<ResearchPanel draft={draft} onJobComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Message Pencraft/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Message Pencraft/i), {
      target: { value: "What do you think?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() =>
      expect(ide.postIdeationMessage).toHaveBeenCalledWith("d1", "What do you think?"),
    );
  });

  it("disables Accept when the latest assistant message has no proposed outline", async () => {
    const ide = await import("../../src/api/ideation");
    (ide.listIdeation as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        position: 0,
        role: "assistant",
        content: "Just chatting",
        proposed_outline: null,
        timestamp: "2026-05-28T00:00:00Z",
      },
    ]);

    render(<ResearchPanel draft={draft} onJobComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Just chatting")).toBeInTheDocument());
    const accept = screen.getByRole("button", { name: /Accept this outline/i });
    expect(accept).toBeDisabled();
  });

  it("enables Accept and renders the outline preview when one is proposed", async () => {
    const ide = await import("../../src/api/ideation");
    (ide.listIdeation as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        position: 0,
        role: "assistant",
        content: "Here's a draft outline",
        proposed_outline: sampleOutline,
        timestamp: "2026-05-28T00:00:00Z",
      },
    ]);

    render(<ResearchPanel draft={draft} onJobComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Once upon a time/i)).toBeInTheDocument());
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    const accept = screen.getByRole("button", { name: /Accept this outline/i });
    expect(accept).not.toBeDisabled();
  });

  it("calls acceptIdeation and onJobComplete when Accept is clicked", async () => {
    const ide = await import("../../src/api/ideation");
    (ide.listIdeation as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        position: 0,
        role: "assistant",
        content: "Outline below",
        proposed_outline: sampleOutline,
        timestamp: "2026-05-28T00:00:00Z",
      },
    ]);
    (ide.acceptIdeation as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...draft,
      stage: "outline",
      outline: sampleOutline,
    });

    const onJobComplete = vi.fn();
    render(<ResearchPanel draft={draft} onJobComplete={onJobComplete} />);

    await waitFor(() => expect(screen.getByText(/Outline below/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Accept this outline/i }));
    await waitFor(() => expect(ide.acceptIdeation).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(onJobComplete).toHaveBeenCalled());
  });
});
