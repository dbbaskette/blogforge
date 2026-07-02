import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", () => ({
  inlineEdit: vi.fn().mockResolvedValue({ text: "A cleaner sentence." }),
}));

import { inlineEdit } from "../../src/api/drafts";
import { ProofreadReviewRail } from "../../src/components/draft/ProofreadReviewRail";
import type { LintResult } from "../../src/lib/issues/proofreadAdapter";

const lint: LintResult = {
  violations: [
    {
      id: "v1",
      kind: "violation",
      section_id: "s1",
      start: 6,
      end: 10,
      match: "very",
      rule: "banished_word",
      message: "Banished word: 'very'",
    },
  ],
  repetitions: [],
};

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
const draft: any = {
  id: "d1",
  sections: [{ id: "s1", content_md: "This is very good writing overall." }],
  outline: { opening_hook: "", sections: [] },
};

describe("ProofreadReviewRail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a card per finding", () => {
    render(<ProofreadReviewRail lint={lint} draft={draft} onSectionSave={vi.fn()} />);
    expect(screen.getByText("Banished word: 'very'")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI fix" })).toBeInTheDocument();
  });

  it("AI fix rewrites the enclosing sentence and moves to review", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    render(<ProofreadReviewRail lint={lint} draft={draft} onSectionSave={onSectionSave} />);
    fireEvent.click(screen.getByRole("button", { name: "AI fix" }));
    await waitFor(() => expect(inlineEdit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());
    expect(onSectionSave).toHaveBeenCalledWith("s1", "A cleaner sentence.");
  });

  it("shows a clean-draft message when there are no findings", () => {
    render(
      <ProofreadReviewRail
        lint={{ violations: [], repetitions: [] }}
        draft={draft}
        onSectionSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/Clean draft/)).toBeInTheDocument();
  });
});
