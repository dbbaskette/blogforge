import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturedEditorOptions = vi.hoisted(() => [] as Array<{ content?: unknown }>);

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (options: Parameters<typeof actual.useEditor>[0]) => {
      if (options) capturedEditorOptions.push(options);
      return actual.useEditor(options);
    },
  };
});

import { MarkdownEditor } from "../../src/components/draft/MarkdownEditor";

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  capturedEditorOptions.length = 0;
});

describe("MarkdownEditor autosave + guard", () => {
  it("debounce-autosaves edits and ignores the echo of its own save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<MarkdownEditor initialMarkdown="hello" onSave={onSave} />);

    // Raw mode keeps the test off TipTap's contentEditable.
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello world" } });

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    // First save of the session snapshots a version (createVersion = true).
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("hello world", true));

    // The saved content echoes back as initialMarkdown (section saves replace the
    // whole draft) — the guard must NOT re-save or clobber.
    onSave.mockClear();
    rerender(<MarkdownEditor initialMarkdown="hello world" onSave={onSave} />);
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("constructs every TipTap instance with the initial section content", () => {
    render(
      <MarkdownEditor
        initialMarkdown={"## Opening\n\nThe first paragraph."}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(capturedEditorOptions).not.toHaveLength(0);
    const lastOptions = capturedEditorOptions[capturedEditorOptions.length - 1];
    expect(lastOptions?.content).toContain("<h2>Opening</h2>");
    expect(lastOptions?.content).toContain("<p>The first paragraph.</p>");
  });
});
