import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DraftSummary } from "../../src/api/drafts";
import { WritingStats } from "../../src/components/WritingStats";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

/** Always inside the current calendar month (the 2nd), even on the 1st. */
function inThisMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
}

/** Always in a previous calendar month. */
function inLastMonth(): string {
  return daysAgo(40);
}

function draft(over: Partial<DraftSummary> = {}): DraftSummary {
  return {
    id: "d1",
    title: "A draft",
    stage: "sections",
    pack_slug: "dan",
    updated_at: daysAgo(0),
    word_count: 100,
    tags: [],
    ...over,
  };
}

describe("WritingStats", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<WritingStats drafts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("counts pieces and words touched this calendar month", () => {
    render(
      <WritingStats
        drafts={[
          draft({ id: "a", updated_at: inThisMonth(), word_count: 1200 }),
          draft({ id: "b", updated_at: inThisMonth(), word_count: 800 }),
          // Last month's update — excluded from monthly counts.
          draft({ id: "c", updated_at: inLastMonth(), word_count: 5000 }),
        ]}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("2.0k")).toBeInTheDocument(); // 1200 + 800
  });

  it("counts pieces by creation date while words follow recent editing activity", () => {
    render(
      <WritingStats
        drafts={[
          draft({
            id: "new",
            created_at: inThisMonth(),
            updated_at: inThisMonth(),
            word_count: 100,
          }),
          draft({
            id: "old-but-edited",
            created_at: inLastMonth(),
            updated_at: inThisMonth(),
            word_count: 900,
          }),
        ]}
      />,
    );

    const values = document.querySelectorAll("span.tabular-nums");
    expect(values[0]).toHaveTextContent("1");
    expect(values[1]).toHaveTextContent("1.0k");
  });

  it("computes a consecutive-week streak ending at the current week", () => {
    render(
      <WritingStats
        drafts={[
          draft({ id: "this-week" }),
          draft({ id: "last-week", updated_at: daysAgo(10) }),
          // Two weeks ago there was activity too…
          draft({ id: "three-back", updated_at: daysAgo(17) }),
        ]}
      />,
    );
    // …so the streak is 3 (current week + 2 prior consecutive buckets).
    // Stats render in order: pieces, words, streak (accented when ≥ 2).
    const streak = document.querySelectorAll("span.tabular-nums")[2];
    expect(streak).toHaveTextContent("3");
  });

  it("breaks the streak when a week had no activity", () => {
    render(
      <WritingStats
        drafts={[draft({ id: "this-week" }), draft({ id: "three-back", updated_at: daysAgo(17) })]}
      />,
    );
    const streak = document.querySelectorAll("span.tabular-nums")[2];
    expect(streak).toHaveTextContent("1");
  });

  it("renders eight sparkline bars", () => {
    const { container } = render(
      <WritingStats
        drafts={[draft(), draft({ id: "b", updated_at: daysAgo(50), word_count: 900 })]}
      />,
    );
    const bars = container.querySelectorAll(".bg-cobalt-400, .bg-rule\\/60");
    expect(bars.length).toBe(8);
  });
});
