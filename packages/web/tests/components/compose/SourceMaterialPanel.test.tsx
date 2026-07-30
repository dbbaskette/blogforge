import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceMaterialPanel } from "../../../src/components/compose/SourceMaterialPanel";

const props = {
  title: "",
  onTitle: vi.fn(),
  sourceText: "",
  onSourceText: vi.fn(),
  onRun: vi.fn(),
  busy: false,
};

describe("SourceMaterialPanel", () => {
  it("explains that Markdown becomes a new blog outline", () => {
    render(<SourceMaterialPanel {...props} />);

    expect(screen.getByText(/doesn't copy its headings/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Blog title")).toBeInTheDocument();
    expect(screen.getByLabelText("Source material")).toBeInTheDocument();
  });

  it("requires both a title and source material", () => {
    const onRun = vi.fn();
    const { rerender } = render(<SourceMaterialPanel {...props} onRun={onRun} />);

    expect(screen.getByRole("button", { name: /build outline/i })).toBeDisabled();

    rerender(
      <SourceMaterialPanel {...props} title="BlogForge" sourceText="# Brief" onRun={onRun} />,
    );

    expect(screen.getByRole("button", { name: /build outline/i })).toBeEnabled();
  });
});
