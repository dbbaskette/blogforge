import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PastePanel, countSections } from "../../../src/components/compose/PastePanel";

function importFile(file: File): void {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("File input was not rendered");
  fireEvent.change(input, { target: { files: [file] } });
}

function fileWithText(name: string, text: string, size = text.length): File {
  return {
    name,
    size,
    text: vi.fn().mockResolvedValue(text),
  } as unknown as File;
}

function renderPastePanel(onText = vi.fn()): ReturnType<typeof render> {
  return render(<PastePanel text="" onText={onText} onRun={vi.fn()} busy={false} />);
}

describe("countSections", () => {
  it("returns 0 for empty/whitespace", () => {
    expect(countSections("")).toBe(0);
    expect(countSections("   \n  ")).toBe(0);
  });

  it("counts one section when there are no headings", () => {
    expect(countSections("Just some prose.\n\nMore prose.")).toBe(1);
  });

  it("counts one section per H2 heading", () => {
    expect(countSections("# Title\n\n## One\n\nx\n\n## Two\n\ny\n\n## Three\n\nz")).toBe(3);
  });

  it("ignores H1 and H3 when counting sections", () => {
    expect(countSections("# Title\n\nlead\n\n## Only\n\n### sub\n\nbody")).toBe(1);
  });
});

describe("PastePanel file imports", () => {
  it("imports prose from a file with a large embedded image and reports its removal", async () => {
    const onText = vi.fn();
    renderPastePanel(onText);
    const payload = "A".repeat(1_050_000);
    const file = fileWithText(
      "draft.md",
      `Before the image.\n\n![chart](data:image/png;base64,${payload})\n\n![logo](https://example.com/logo.png)\n\nAfter the image.`,
    );

    importFile(file);

    await waitFor(() => {
      expect(onText).toHaveBeenCalledWith(
        "Before the image.\n\n[Image omitted during import: chart]\n\n![logo](https://example.com/logo.png)\n\nAfter the image.",
      );
    });
    expect(onText.mock.calls[0][0]).not.toContain(payload);
    expect(screen.getByText(/removed 1 embedded image/i)).toBeInTheDocument();
  });

  it("rejects a raw file larger than 25 MB before reading it", async () => {
    const onText = vi.fn();
    renderPastePanel(onText);
    const file = fileWithText("large.md", "Short prose.", 25_000_001);

    importFile(file);

    expect(onText).not.toHaveBeenCalled();
    expect(file.text).not.toHaveBeenCalled();
    expect(screen.getByText(/too large to import/i)).toBeInTheDocument();
  });

  it("rejects import text longer than 200,000 cleaned characters", async () => {
    const onText = vi.fn();
    renderPastePanel(onText);
    const file = fileWithText("long.md", "a".repeat(200_001));

    importFile(file);

    await waitFor(() => {
      expect(screen.getByText(/too long to import/i)).toBeInTheDocument();
    });
    expect(onText).not.toHaveBeenCalled();
  });
});
