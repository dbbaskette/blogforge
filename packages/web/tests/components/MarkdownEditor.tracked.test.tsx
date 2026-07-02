import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../../src/components/draft/MarkdownEditor";

describe("MarkdownEditor tracked-change decoration", () => {
  it("colors pending text runs in the rich editor", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <MarkdownEditor
        initialMarkdown="the happy cat sat"
        onSave={onSave}
        pendingTexts={["happy"]}
      />,
    );
    await waitFor(() => {
      const marked = container.querySelector(".tracked-change");
      expect(marked).not.toBeNull();
      expect(marked?.textContent).toBe("happy");
    });
  });

  it("renders no decoration when there are no pending runs", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <MarkdownEditor initialMarkdown="plain text here" onSave={onSave} pendingTexts={[]} />,
    );
    // Give the editor a tick to mount + load content.
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
    expect(container.querySelector(".tracked-change")).toBeNull();
  });
});
