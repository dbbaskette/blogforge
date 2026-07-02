import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceUrlsField } from "../../src/components/compose/SourceUrlsField";

describe("SourceUrlsField", () => {
  it("emits non-blank http(s) URLs on change", () => {
    const onChange = vi.fn();
    render(<SourceUrlsField value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Source URL 1"), {
      target: { value: "https://x.example" },
    });
    expect(onChange).toHaveBeenLastCalledWith(["https://x.example"]);
  });

  it("adds and removes rows", () => {
    const onChange = vi.fn();
    render(<SourceUrlsField value={["https://a.example"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add source"));
    fireEvent.change(screen.getByLabelText("Source URL 2"), {
      target: { value: "https://b.example" },
    });
    expect(onChange).toHaveBeenLastCalledWith(["https://a.example", "https://b.example"]);
    fireEvent.click(screen.getByLabelText("Remove source URL 2"));
    expect(onChange).toHaveBeenLastCalledWith(["https://a.example"]);
  });

  it("drops a non-http value from the emitted list and shows a hint", () => {
    const onChange = vi.fn();
    render(<SourceUrlsField value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Source URL 1"), {
      target: { value: "not-a-url" },
    });
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByText(/must start with http/i)).toBeInTheDocument();
  });
});
