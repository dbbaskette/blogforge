import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FixPreviewModal } from "../../../src/components/review/FixPreviewModal";

const props = {
  title: "Comma-spliced run of three clauses",
  leverLabel: "Flow & Rhythm",
  why: "Three clauses spliced with commas read as one breathless run.",
  before: "It works, it ships, it scales.",
  after: "It works. It ships. And it scales.",
};

describe("FixPreviewModal", () => {
  it("renders header, both panes, and the why line", () => {
    render(<FixPreviewModal {...props} onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: /comma-spliced run/i })).toBeInTheDocument();
    expect(screen.getByText("Comma-spliced run of three clauses")).toBeInTheDocument();
    expect(screen.getByText("Flow & Rhythm")).toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("AI rewrite")).toBeInTheDocument();
    expect(screen.getByText(/breathless run/)).toBeInTheDocument();
    // Side logic: removed words render as <del> in the original pane, added
    // words as <mark> in the rewrite pane.
    expect(document.querySelector("del")?.textContent).toContain("works,");
    expect(document.querySelector("mark")?.textContent).toContain("And");
  });

  it("Apply passes the (unedited) rewrite; Cancel calls onCancel", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<FixPreviewModal {...props} onApply={onApply} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("It works. It ships. And it scales.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Edit rewrite turns the right pane into a textarea and Apply passes the edit", () => {
    const onApply = vi.fn();
    render(<FixPreviewModal {...props} onApply={onApply} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rewrite" }));
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue(props.after);
    fireEvent.change(box, { target: { value: "My own version." } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("My own version.");
  });

  it("disables Apply while busy", () => {
    render(<FixPreviewModal {...props} busy onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /applying|apply/i })).toBeDisabled();
  });

  it("does not cancel while busy", () => {
    const onCancel = vi.fn();
    render(<FixPreviewModal {...props} busy onApply={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Back to compare returns to the diff panes; Edit rewrite prefills again", () => {
    render(<FixPreviewModal {...props} onApply={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rewrite" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to compare" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("AI rewrite")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit rewrite" }));
    expect(screen.getByRole("textbox")).toHaveValue(props.after);
  });
});
