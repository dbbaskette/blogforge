import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HighlightedText, findHighlight } from "../../../src/components/review/HighlightedText";

describe("findHighlight (tolerant matching)", () => {
  const src = "This is very  good writing, and it should stand alone here.";

  it("matches exactly", () => {
    expect(findHighlight(src, "very  good")).toEqual({ start: 8, end: 18 });
  });

  it("tolerates whitespace drift", () => {
    // snippet has single space; source has two — should still match
    const hit = findHighlight(src, "very good writing");
    expect(hit).not.toBeNull();
    expect(src.slice(hit?.start, hit?.end)).toContain("very");
  });

  it("tolerates wrapping quotes and trailing ellipsis", () => {
    expect(findHighlight(src, '"very  good"')).toEqual({ start: 8, end: 18 });
    const hit = findHighlight(src, "and it should stand alone…");
    expect(hit).not.toBeNull();
  });

  it("is case-insensitive", () => {
    const hit = findHighlight(src, "VERY  GOOD");
    expect(hit).toEqual({ start: 8, end: 18 });
  });

  it("falls back to a leading prefix for truncated snippets", () => {
    const hit = findHighlight(src, "and it should stand alone here, plus text not in the source");
    expect(hit).not.toBeNull();
    expect(src.slice(hit?.start, hit?.end)).toContain("and it should");
  });

  it("returns null when nothing plausibly matches", () => {
    expect(findHighlight(src, "totally unrelated phrase")).toBeNull();
  });
});

describe("HighlightedText", () => {
  it("wraps the located run in a kind-tagged mark", () => {
    const { container } = render(
      <HighlightedText text="This is very good writing." mark="very good" kind="under-review" />,
    );
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("very good");
    expect(mark?.className).toContain("tracked-change--under-review");
  });

  it("highlights despite whitespace + quotes drift", () => {
    const { container } = render(
      <HighlightedText text="A wall   of dense text here." mark='"A wall of dense text"' />,
    );
    expect(container.querySelector("mark")?.textContent).toBe("A wall   of dense text");
  });

  it("renders plain text when there is no mark", () => {
    const { container } = render(<HighlightedText text="Nothing to see." />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Nothing to see.");
  });
});
