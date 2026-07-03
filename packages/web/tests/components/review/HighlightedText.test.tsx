import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HighlightedText } from "../../../src/components/review/HighlightedText";

describe("HighlightedText", () => {
  it("wraps the matched run in a kind-tagged mark", () => {
    const { container } = render(
      <HighlightedText text="This is very good writing." mark="very" kind="under-review" />,
    );
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("very");
    expect(mark?.className).toContain("tracked-change--under-review");
  });

  it("renders plain text when there is no mark", () => {
    const { container } = render(<HighlightedText text="Nothing to see." />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Nothing to see.");
  });

  it("renders plain text when the mark isn't present", () => {
    const { container } = render(<HighlightedText text="Nothing to see." mark="absent" />);
    expect(container.querySelector("mark")).toBeNull();
  });
});
