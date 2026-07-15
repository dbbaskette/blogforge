import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IssueCard } from "../../../src/components/review/IssueCard";
import type { Issue } from "../../../src/lib/issues/types";

const base: Issue = {
  id: "shape:reword:1",
  panel: "shape",
  lever: "reword",
  title: "Tighten this sentence",
  why: "It rambles.",
  nature: "fix",
  sectionId: "s1",
  target: "the original text",
  actions: ["choose_option", "dismiss"],
  status: "open",
};

const noop = (): void => {};

describe("IssueCard option chips", () => {
  it("renders each option as a chip", () => {
    render(
      <IssueCard
        issue={{ ...base, options: ["Alt one", "Alt two"] }}
        onAction={noop}
        onAccept={noop}
        onUndo={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Alt one" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alt two" })).toBeInTheDocument();
  });

  it("dispatches choose_option with the picked option", () => {
    const onAction = vi.fn();
    render(
      <IssueCard
        issue={{ ...base, options: ["Alt one", "Alt two"] }}
        onAction={onAction}
        onAccept={noop}
        onUndo={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alt two" }));
    expect(onAction).toHaveBeenCalledWith("choose_option", "Alt two");
  });

  it("omits the generic choose_option button when options render as chips", () => {
    render(
      <IssueCard
        issue={{ ...base, options: ["Alt one"] }}
        onAction={noop}
        onAccept={noop}
        onUndo={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "Pick one" })).not.toBeInTheDocument();
  });

  it("still renders the generic button when there are no options", () => {
    render(<IssueCard issue={base} onAction={noop} onAccept={noop} onUndo={noop} />);
    expect(screen.getByRole("button", { name: "Pick one" })).toBeInTheDocument();
  });
});

describe("IssueCard impact label", () => {
  it("prefixes impact only when impactLabel is set", () => {
    const { rerender } = render(
      <IssueCard
        issue={{ ...base, impact: "more citations", impactLabel: "GEO" }}
        onAction={noop}
        onAccept={noop}
        onUndo={noop}
      />,
    );
    expect(screen.getByText("GEO: more citations")).toBeInTheDocument();
    rerender(
      <IssueCard
        issue={{ ...base, impact: "more citations" }}
        onAction={noop}
        onAccept={noop}
        onUndo={noop}
      />,
    );
    expect(screen.getByText("more citations")).toBeInTheDocument();
  });
});

describe("IssueCard why", () => {
  it("renders whatever why it is given (dedupe is the rail's job)", () => {
    render(<IssueCard issue={base} onAction={noop} onAccept={noop} onUndo={noop} />);
    expect(screen.getByText("It rambles.")).toBeInTheDocument();
  });
  it("renders no why when absent", () => {
    render(
      <IssueCard issue={{ ...base, why: "" }} onAction={noop} onAccept={noop} onUndo={noop} />,
    );
    expect(screen.queryByText("It rambles.")).not.toBeInTheDocument();
  });
});
