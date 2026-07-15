import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewRail } from "../../../src/components/review/ReviewRail";
import type { Issue } from "../../../src/lib/issues/types";

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "geo:lv:1",
  panel: "geo",
  lever: "lv",
  title: "A title",
  why: "A reason",
  nature: "fix",
  sectionId: "s1",
  actions: ["dismiss"],
  status: "open",
  ...over,
});

const noopApply = vi.fn().mockResolvedValue(null);
const noopSave = vi.fn().mockResolvedValue(undefined);

function renderRail(props: Partial<React.ComponentProps<typeof ReviewRail>> = {}) {
  return render(
    <ReviewRail
      issues={[issue()]}
      groups={[{ key: "lv", label: "Lever" }]}
      draftId="d1"
      apply={noopApply}
      save={noopSave}
      emptyState={<p>All clear</p>}
      {...props}
    />,
  );
}

beforeEach(() => localStorage.clear());

describe("ReviewRail grouping", () => {
  it("renders issues under their group", () => {
    renderRail();
    expect(screen.getByText("Lever")).toBeInTheDocument();
    expect(screen.getByText("A title")).toBeInTheDocument();
  });
  it("skips groups with no issues", () => {
    renderRail({
      groups: [
        { key: "lv", label: "Lever" },
        { key: "other", label: "Empty" },
      ],
    });
    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
  });
  it("renders groups in the given order", () => {
    renderRail({
      issues: [issue({ id: "a", lever: "two" }), issue({ id: "b", lever: "one" })],
      groups: [
        { key: "one", label: "First" },
        { key: "two", label: "Second" },
      ],
    });
    const heads = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(heads).toEqual(["First", "Second"]);
  });
  it("shows the empty state when there are no issues", () => {
    renderRail({ issues: [] });
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });
  it("renders the pluggable group header", () => {
    renderRail({ groups: [{ key: "lv", label: "Lever", header: <span>SCORE 42</span> }] });
    expect(screen.getByText("SCORE 42")).toBeInTheDocument();
  });
});

describe("ReviewRail why dedupe", () => {
  it("hides why when it equals the title", () => {
    renderRail({ issues: [issue({ title: "Same text", why: "Same text" })] });
    expect(screen.getAllByText("Same text")).toHaveLength(1);
  });
  it("hides why when it equals the group detail", () => {
    renderRail({
      issues: [issue({ why: "Group prose" })],
      groups: [{ key: "lv", label: "Lever", detail: "Group prose" }],
    });
    expect(screen.getAllByText("Group prose")).toHaveLength(1);
  });
  it("shows why when it adds information", () => {
    renderRail({ issues: [issue({ title: "T", why: "Distinct reason" })] });
    expect(screen.getByText("Distinct reason")).toBeInTheDocument();
  });
});

describe("ReviewRail dismiss", () => {
  it("hides a dismissed issue and offers to show it", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("A title")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show dismissed \(1\)/ })).toBeInTheDocument();
  });
  it("reveals and restores a dismissed issue", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: /Show dismissed \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByText("A title")).toBeInTheDocument();
  });
  it("persists a dismissal across remounts", () => {
    const { unmount } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    unmount();
    renderRail();
    expect(screen.queryByText("A title")).not.toBeInTheDocument();
  });
  it("shows the empty state when every issue is dismissed", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });
});
