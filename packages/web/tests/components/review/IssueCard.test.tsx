import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueCard } from "../../../src/components/review/IssueCard";
import type { Issue } from "../../../src/lib/issues/types";

const fixIssue: Issue = {
  id: "i1",
  panel: "geo",
  lever: "answer_first",
  title: "This section buries its answer",
  why: "Lead with the takeaway.",
  nature: "fix",
  sectionId: "s1",
  target: "There are a few things worth considering…",
  actions: ["ai_fix", "manual_fix", "highlight"],
  status: "open",
};

describe("IssueCard", () => {
  const onAction = vi.fn();
  const onAccept = vi.fn();
  const onUndo = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  const renderCard = (issue: Issue) =>
    render(<IssueCard issue={issue} onAction={onAction} onAccept={onAccept} onUndo={onUndo} />);

  it("open fix issue shows its adaptive actions and title", () => {
    renderCard(fixIssue);
    expect(screen.getByText(/buries its answer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI fix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manual fix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Highlight" })).toBeInTheDocument();
  });

  it("fires onAction for a non-input action", () => {
    renderCard(fixIssue);
    fireEvent.click(screen.getByRole("button", { name: "AI fix" }));
    expect(onAction).toHaveBeenCalledWith("ai_fix");
  });

  it("Manual fix opens an inline editor and applies typed text", () => {
    renderCard(fixIssue);
    fireEvent.click(screen.getByRole("button", { name: "Manual fix" }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "A tighter opening line." } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onAction).toHaveBeenCalledWith("manual_fix", "A tighter opening line.");
  });

  it("review state shows Accept and Undo", () => {
    renderCard({ ...fixIssue, status: "review" });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
  });

  it("accepted state collapses to a done row with Undo", () => {
    renderCard({ ...fixIssue, status: "accepted" });
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
  });

  it("advisory issue offers Dismiss and no red styling label", () => {
    renderCard({
      ...fixIssue,
      nature: "advisory",
      target: undefined,
      actions: ["highlight", "dismiss"],
    });
    expect(screen.getByText("Advisory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
