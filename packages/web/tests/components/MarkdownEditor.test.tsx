import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../../src/components/draft/MarkdownEditor";

afterEach(() => {
  vi.useRealTimers();
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

  // Guards the WebKit blank-editor workaround: mounting must schedule a
  // frame-aligned reflow AND that reflow must restore the editor's display —
  // never leave the contenteditable hidden. (jsdom can't reproduce the actual
  // WebKit paint miss; this locks in the workaround's shape so it isn't silently
  // dropped again, as happened in b894b62.)
  it("schedules a repaint reflow on first load and never leaves the editor hidden", () => {
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback): number => {
        frames.push(cb);
        return frames.length;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { container } = render(
      <MarkdownEditor
        initialMarkdown="hello world"
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const pm = container.querySelector<HTMLElement>(".prose-body");
    expect(pm).not.toBeNull();

    // The seed effect schedules the frame-aligned repaint.
    expect(frames.length).toBeGreaterThan(0);

    // Drain the double-rAF reflow (nested frames enqueue more callbacks).
    for (let i = 0; i < frames.length && i < 10; i++) frames[i](0);

    // The reflow toggles display off then MUST restore it.
    expect(pm?.style.display).not.toBe("none");

    rafSpy.mockRestore();
  });
});
