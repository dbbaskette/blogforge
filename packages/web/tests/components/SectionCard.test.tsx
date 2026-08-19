import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiError } from "../../src/api/client";
import type { Section } from "../../src/api/drafts";
import { SectionCard } from "../../src/components/draft/SectionCard";

function makeSection(over: Partial<Section> = {}): Section {
  return {
    id: "s1",
    title: "Opening",
    brief: "",
    content_md: "",
    status: "generating",
    last_generated_at: null,
    last_error: null,
    word_count: 0,
    ...over,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const noop = async (): Promise<void> => {};

const baseProps = {
  index: 0,
  draftId: "draft-1",
  onSave: noop,
  onRegenerate: noop,
  onRevert: noop,
  onMoveUp: () => {},
  onMoveDown: () => {},
  canMoveUp: false,
  canMoveDown: false,
};

describe("SectionCard", () => {
  it("renders live streaming prose when given liveText", () => {
    render(
      <SectionCard
        {...baseProps}
        section={makeSection()}
        isGenerating
        liveText="The streaming first sentence"
        defaultOpen
      />,
    );
    expect(screen.getByText(/the streaming first sentence/i)).toBeInTheDocument();
  });

  it("falls back to the spinner while generating without live text", () => {
    render(<SectionCard {...baseProps} section={makeSection()} isGenerating defaultOpen />);
    expect(screen.getByText(/composing this section/i)).toBeInTheDocument();
  });

  it("passes a typed revision note to onRegenerate (guided regen)", async () => {
    const onRegenerate = vi.fn(async (): Promise<void> => {});
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "ready", content_md: "Existing prose.", word_count: 2 })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.change(screen.getByLabelText(/revision note/i), {
      target: { value: "tighten this" },
    });
    fireEvent.click(screen.getByRole("button", { name: /regenerate with note/i }));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith("tighten this"));
  });

  it("regenerates with no instruction when the note is blank", async () => {
    const onRegenerate = vi.fn(async (): Promise<void> => {});
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "ready", content_md: "Existing prose.", word_count: 2 })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^regenerate$/i }));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith(undefined));
  });

  it("parses a legacy HTTP failure and offers Retry without exposing raw details", () => {
    const onRegenerate = vi.fn(async (): Promise<void> => {});
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({
          status: "failed",
          last_error: 'HTTP 502: {"provider":"offline"}',
        })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The service is unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compose this section/i })).not.toBeInTheDocument();
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("HTTP 502");
  });

  it("restores Settings recovery from a structured persisted provider failure", () => {
    const persisted = JSON.stringify({
      version: 1,
      code: "provider_missing_key",
      message: "No API key configured for provider 'anthropic'.",
      hint: "Add the key in Settings.",
    });
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "failed", last_error: persisted })}
        isGenerating={false}
        defaultOpen
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Check your AI provider");
    expect(alert).not.toHaveTextContent(persisted);
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("restores Sign in and Reload recovery from persisted metadata", () => {
    const { rerender } = render(
      <SectionCard
        {...baseProps}
        section={makeSection({
          status: "failed",
          last_error: JSON.stringify({
            version: 1,
            status: 401,
            code: "session_revoked",
            message: "Session expired.",
          }),
        })}
        isGenerating={false}
        defaultOpen
      />,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

    rerender(
      <SectionCard
        {...baseProps}
        section={makeSection({
          status: "failed",
          last_error: JSON.stringify({
            version: 1,
            status: 409,
            code: "draft_conflict",
            message: "Draft changed elsewhere.",
          }),
        })}
        isGenerating={false}
        defaultOpen
      />,
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("shows an identical persisted failure again after a retry generation cycle", async () => {
    const persisted = JSON.stringify({
      version: 1,
      code: "generation_interrupted",
      message: "Generation was interrupted before it finished. Please retry.",
    });
    const retry = deferred();
    const onRegenerate = vi.fn(() => retry.promise);
    const { rerender } = render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "failed", last_error: persisted })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "generating", last_error: null })}
        isGenerating
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );
    await act(async () => retry.resolve());
    rerender(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "failed", last_error: persisted })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("lets the writer dismiss a generic persisted failure and continue editing", () => {
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({
          status: "failed",
          content_md: "Preserved prose.",
          last_error: "Generation was interrupted before it finished.",
        })}
        isGenerating={false}
        defaultOpen
      />,
    );

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Preserved prose.")).toBeInTheDocument();
  });

  it("offers Retry when a section regeneration request fails", async () => {
    const onRegenerate = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("upstream response"), { status: 503 }) as ApiError,
      )
      .mockResolvedValueOnce(undefined);
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "ready", content_md: "Existing prose.", word_count: 2 })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^regenerate$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The service is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onRegenerate).toHaveBeenCalledTimes(2));
  });

  it("retries the exact failed regeneration instruction after the note changes", async () => {
    const onRegenerate = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("upstream response"), { status: 503 }))
      .mockResolvedValueOnce(undefined);
    render(
      <SectionCard
        {...baseProps}
        section={makeSection({ status: "ready", content_md: "Existing prose.", word_count: 2 })}
        isGenerating={false}
        defaultOpen
        onRegenerate={onRegenerate}
      />,
    );

    const note = screen.getByLabelText(/revision note/i);
    fireEvent.change(note, { target: { value: "tighten the opening" } });
    fireEvent.click(screen.getByRole("button", { name: /regenerate with note/i }));
    await screen.findByRole("alert");
    fireEvent.change(note, { target: { value: "add a new example" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onRegenerate).toHaveBeenCalledTimes(2));
    expect(onRegenerate).toHaveBeenLastCalledWith("tighten the opening");
  });
});
