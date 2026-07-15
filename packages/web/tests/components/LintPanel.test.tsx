import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../src/api/drafts");
  return { ...actual, lintDraft: vi.fn(), checkClaims: vi.fn() };
});

import { lintDraft } from "../../src/api/drafts";
import { LintPanel } from "../../src/components/draft/LintPanel";

const draft = {
  id: "d1",
  title: "T",
  sections: [{ id: "s1", title: "S", content_md: "It is very unique.", word_count: 4 }],
} as never;

const finding = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  kind: "violation",
  rule: "banned_phrase",
  message: "Avoid “very unique”",
  match: "very unique",
  section_id: "s1",
  ...over,
});

function renderPanel() {
  return render(
    <MemoryRouter>
      <LintPanel
        draft={draft}
        onSectionSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(lintDraft).mockReset();
});

describe("LintPanel on the shared rail", () => {
  it("renders its findings as issue cards grouped by rule", async () => {
    vi.mocked(lintDraft).mockResolvedValue({
      violations: [finding()],
      repetitions: [],
      hits: [],
    } as never);
    renderPanel();
    expect(await screen.findByText("Avoid “very unique”")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "banned_phrase" })).toBeInTheDocument();
  });

  it("offers Dismiss on every finding and hides it behind the show toggle", async () => {
    vi.mocked(lintDraft).mockResolvedValue({
      violations: [finding()],
      repetitions: [],
      hits: [],
    } as never);
    const { getByRole } = renderPanel();
    await screen.findByText("Avoid “very unique”");

    getByRole("button", { name: "Dismiss" }).click();
    await waitFor(() => expect(screen.queryByText("Avoid “very unique”")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Show dismissed \(1\)/ })).toBeInTheDocument();
  });

  it("shows the clean-copy empty state when nothing is flagged", async () => {
    vi.mocked(lintDraft).mockResolvedValue({ violations: [], repetitions: [], hits: [] } as never);
    renderPanel();
    expect(await screen.findByText(/Nothing flagged — clean copy/)).toBeInTheDocument();
  });

  it("does NOT improve the Humanity Score when a finding is merely dismissed", async () => {
    // The score reflects what's still WRONG IN THE TEXT. Dismissing declutters
    // the list; leaving the phrase in place doesn't make the writing more human,
    // so the score must not move. humanityScore = 100 - open*6 → 2 open = 88.
    // If a dismissal wrongly counted as resolved it would jump to 94.
    vi.mocked(lintDraft).mockResolvedValue({
      violations: [
        finding(),
        finding({ id: "f2", match: "leverage", message: "Avoid “leverage”" }),
      ],
      repetitions: [],
      hits: [],
    } as never);
    renderPanel();
    await screen.findByText("Avoid “very unique”");
    expect(screen.getByText("88")).toBeInTheDocument();

    screen.getAllByRole("button", { name: "Dismiss" })[0].click();
    await waitFor(() => expect(screen.queryByText("Avoid “very unique”")).not.toBeInTheDocument());

    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.queryByText("94")).not.toBeInTheDocument();
  });

  it("DOES improve the Humanity Score once a fix is actually applied, and unwinds on Undo", async () => {
    // The other half of the semantic: fixing the text must move the score, and
    // Undo — which puts the flagged text back — must move it back.
    vi.mocked(lintDraft).mockResolvedValue({
      violations: [
        finding(),
        finding({ id: "f2", match: "leverage", message: "Avoid “leverage”" }),
      ],
      repetitions: [],
      hits: [],
    } as never);
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LintPanel draft={draft} onSectionSave={onSectionSave} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Avoid “very unique”");
    expect(screen.getByText("88")).toBeInTheDocument(); // 2 open

    // Apply a manual fix (no model call, no preview) → one finding resolved.
    await act(async () => {
      screen.getAllByRole("button", { name: "Manual fix" })[0].click();
    });
    const box = await screen.findByRole("textbox");
    await act(async () => {
      fireEvent.change(box, { target: { value: "unusual" } });
      screen.getByRole("button", { name: "Apply" }).click();
    });
    await waitFor(() => expect(screen.getByText("94")).toBeInTheDocument()); // 1 open

    // Undo restores the flagged text — the score must go back.
    await act(async () => {
      screen.getByRole("button", { name: "Undo" }).click();
    });
    await waitFor(() => expect(screen.getByText("88")).toBeInTheDocument());
  });
});
