import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceFooter } from "../../src/components/draft/WorkspaceFooter";

const baseProps = {
  draftId: "d1",
  totalWords: 120,
  draftedCount: 2,
  sectionCount: 2,
  onLint: vi.fn(),
};

beforeEach(() => {
  // jsdom lacks clipboard; stub it so the Copy button doesn't blow up.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("WorkspaceFooter", () => {
  it("renders Copy, Download and Lint and fires onLint", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByRole("button", { name: /copy markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download \.md/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^lint$/i }));
    expect(baseProps.onLint).toHaveBeenCalled();
  });

  it("shows the word + drafted-count stats", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });
});
