import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReferenceLibraryPicker } from "../../src/components/draft/ReferenceLibraryPicker";

const libItem = {
  id: "lib-1",
  kind: "text" as const,
  name: "Reusable notes",
  url: null,
  original_filename: null,
  extracted_chars: 12,
  added_at: "2026-05-01T00:00:00Z",
};

vi.mock("../../src/api/library", () => ({
  listLibraryReferences: vi.fn().mockResolvedValue([
    {
      id: "lib-1",
      kind: "text",
      name: "Reusable notes",
      url: null,
      original_filename: null,
      extracted_chars: 12,
      added_at: "2026-05-01T00:00:00Z",
    },
  ]),
  addReferenceFromLibrary: vi.fn().mockResolvedValue({
    id: "ref-new",
    kind: "text",
    name: "Reusable notes",
    url: null,
    original_filename: null,
    extracted_chars: 12,
    added_at: "2026-05-02T00:00:00Z",
  }),
  deleteLibraryReference: vi.fn().mockResolvedValue(undefined),
}));

describe("ReferenceLibraryPicker", () => {
  it("adds a library reference to the draft", async () => {
    const onAdded = vi.fn();
    render(<ReferenceLibraryPicker draftId="d1" attachedNames={new Set()} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole("button", { name: /add from library/i }));
    const addBtn = await screen.findByRole("button", { name: /^add$/i });
    fireEvent.click(addBtn);

    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "ref-new" })),
    );
  });

  it("disables items already attached to the draft", async () => {
    render(
      <ReferenceLibraryPicker
        draftId="d1"
        attachedNames={new Set([libItem.name])}
        onAdded={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add from library/i }));
    const added = await screen.findByRole("button", { name: /^added$/i });
    expect(added).toBeDisabled();
  });
});
