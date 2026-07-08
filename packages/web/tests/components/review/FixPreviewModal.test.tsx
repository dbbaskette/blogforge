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
    expect(screen.getByRole("dialog", { name: /compare fix/i })).toBeInTheDocument();
    expect(screen.getByText("Comma-spliced run of three clauses")).toBeInTheDocument();
    expect(screen.getByText("Flow & Rhythm")).toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("AI rewrite")).toBeInTheDocument();
    expect(screen.getByText(/breathless run/)).toBeInTheDocument();
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
    fireEvent.change(box, { target: { value: "My own version." } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith("My own version.");
  });

  it("disables Apply while busy", () => {
    render(<FixPreviewModal {...props} busy onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /applying|apply/i })).toBeDisabled();
  });
});
