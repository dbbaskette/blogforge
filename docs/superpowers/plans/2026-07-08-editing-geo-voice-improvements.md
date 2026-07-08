# Editing, GEO, and Voice Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six-part spec in `docs/superpowers/specs/2026-07-08-editing-geo-voice-improvements-design.md`: staccato-pairs AI-tell, fix-preview diff modal, GEO impact lines, eight new GEO levers, voice fingerprint/distill/exemplar upgrades, and citation findings that use attached sources.

**Architecture:** Frontend adds a pure `wordDiff` util, a shared `FixPreviewModal`, and a preview phase on `useIssueLifecycle` (appliers gain a `persist:false` mode; the lifecycle saves on confirm). Backend extends `voice/lint.py` (deterministic detector), `generate/geo.py` (impact field, 8 new semantic levers, references-aware citations), `voice/pack.py` + `voice/distill.py` + `voice/compose.py` (fingerprint/exemplars/distill v2). Everything is TDD with per-task commits on branch `feat/editing-geo-voice-improvements`.

**Tech Stack:** React 18 + TypeScript + Vitest/Testing Library (packages/web); Python 3.12 + FastAPI + pytest (packages/api). Web tests: `cd packages/web && npx vitest run <file>`. API tests: `cd packages/api && uv run pytest <file> -q`. Typecheck: `cd packages/web && npx tsc --noEmit`.

**Conventions:** Frontend styling uses the BlogForge notebook theme (`nb-card`, `nb-btn`, `rounded-nb`, tokens like `text-ink`, `bg-amber-soft`, `border-rule`). Every commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `wordDiff` pure utility

**Files:**
- Create: `packages/web/src/lib/wordDiff.ts`
- Test: `packages/web/tests/lib/wordDiff.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/tests/lib/wordDiff.test.ts
import { describe, expect, it } from "vitest";
import { type DiffSeg, trimContext, wordDiff } from "../../src/lib/wordDiff";

const join = (segs: DiffSeg[], kinds: string[]): string =>
  segs.filter((s) => kinds.includes(s.kind)).map((s) => s.text).join(" ");

describe("wordDiff", () => {
  it("marks identical text as one same segment", () => {
    const segs = wordDiff("the same text", "the same text");
    expect(segs).toEqual([{ kind: "same", text: "the same text" }]);
  });

  it("marks a full replacement as removed + added", () => {
    const segs = wordDiff("old words here", "brand new phrasing entirely");
    expect(segs.map((s) => s.kind)).toEqual(["removed", "added"]);
  });

  it("isolates a mid-sentence edit", () => {
    const segs = wordDiff("keep this old middle keep end", "keep this new middle keep end");
    // left view = same + removed reconstructs the original
    expect(join(segs, ["same", "removed"])).toBe("keep this old middle keep end");
    // right view = same + added reconstructs the rewrite
    expect(join(segs, ["same", "added"])).toBe("keep this new middle keep end");
    expect(segs.some((s) => s.kind === "removed" && s.text === "old")).toBe(true);
    expect(segs.some((s) => s.kind === "added" && s.text === "new")).toBe(true);
  });

  it("treats whitespace reflow (newlines vs spaces) as no change", () => {
    const segs = wordDiff("one two\nthree", "one two three");
    expect(segs).toEqual([{ kind: "same", text: "one two three" }]);
  });
});

describe("trimContext", () => {
  it("keeps only N context words around changes and adds ellipses", () => {
    const before = `${"pad ".repeat(30)}CHANGED ${"pad ".repeat(30)}`.trim();
    const after = `${"pad ".repeat(30)}REWRITTEN ${"pad ".repeat(30)}`.trim();
    const segs = trimContext(wordDiff(before, after), 5);
    // Same-run heads/tails are trimmed to 5 words + ellipsis marker.
    const firstSame = segs.find((s) => s.kind === "same");
    expect(firstSame && firstSame.text.split(" ").length).toBeLessThanOrEqual(6); // "…" + 5
    expect(segs[0].text.startsWith("…")).toBe(true);
  });

  it("returns segments unchanged when text is short", () => {
    const segs = wordDiff("a b c", "a x c");
    expect(trimContext(segs, 12)).toEqual(segs);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run tests/lib/wordDiff.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/wordDiff`

- [ ] **Step 3: Implement**

```ts
// packages/web/src/lib/wordDiff.ts
/**
 * Word-level diff for the fix-preview modal. Pure + dependency-free.
 * Tokenizes on whitespace (so reflow is not a change), builds a classic LCS
 * table, and merges the backtrace into runs. O(n*m) — fine for section-sized
 * text (a few hundred words).
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffSeg {
  kind: DiffKind;
  text: string;
}

const tokens = (s: string): string[] => s.split(/\s+/).filter(Boolean);

export function wordDiff(before: string, after: string): DiffSeg[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Backtrace into per-word ops, then merge consecutive ops of one kind.
  const segs: DiffSeg[] = [];
  const push = (kind: DiffKind, word: string): void => {
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.text += ` ${word}`;
    else segs.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) {
    push("removed", a[i]);
    i++;
  }
  while (j < m) {
    push("added", b[j]);
    j++;
  }
  return segs;
}

/**
 * Trim long unchanged runs so the modal shows the change plus a little
 * context, not the whole section. Head/tail context inside a long same-run is
 * kept (contextWords each side) and the elided middle becomes an "…" marker.
 */
export function trimContext(segs: DiffSeg[], contextWords = 12): DiffSeg[] {
  return segs.map((seg, idx) => {
    if (seg.kind !== "same") return seg;
    const words = seg.text.split(" ");
    const isFirst = idx === 0;
    const isLast = idx === segs.length - 1;
    // Budget: edge runs only need context on their inner side.
    const budget = (isFirst || isLast ? 1 : 2) * contextWords;
    if (words.length <= budget + 1) return seg;
    if (isFirst) return { ...seg, text: `… ${words.slice(-contextWords).join(" ")}` };
    if (isLast) return { ...seg, text: `${words.slice(0, contextWords).join(" ")} …` };
    return {
      ...seg,
      text: `${words.slice(0, contextWords).join(" ")} … ${words.slice(-contextWords).join(" ")}`,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run tests/lib/wordDiff.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/wordDiff.ts packages/web/tests/lib/wordDiff.test.ts
git commit -m "feat(review): word-level LCS diff util for the fix-preview modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `FixPreviewModal` component

**Files:**
- Create: `packages/web/src/components/review/FixPreviewModal.tsx`
- Test: `packages/web/tests/components/review/FixPreviewModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/web/tests/components/review/FixPreviewModal.test.tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run tests/components/review/FixPreviewModal.test.tsx`
Expected: FAIL — cannot resolve FixPreviewModal

- [ ] **Step 3: Implement**

```tsx
// packages/web/src/components/review/FixPreviewModal.tsx
import { useMemo, useState } from "react";

import { trimContext, wordDiff } from "../../lib/wordDiff";
import { useDialogA11y } from "../ui/useDialogA11y";

interface FixPreviewModalProps {
  /** Finding headline shown in the modal header. */
  title: string;
  /** Lens/lever chip label (e.g. "Flow & Rhythm", "Answer-first sections"). */
  leverLabel?: string;
  /** The finding's rationale line. */
  why?: string;
  /** Full field text before the fix. */
  before: string;
  /** Full field text after the fix. */
  after: string;
  busy?: boolean;
  /** Called with the final text to persist (the rewrite, or the user's edit). */
  onApply: (finalAfter: string) => void;
  onCancel: () => void;
}

/**
 * Preview-first compare for AI fixes: original and rewrite side by side with
 * word-level change highlighting. NOTHING is saved until Apply. "Edit rewrite"
 * swaps the right pane for a textarea so a close-but-not-quite suggestion can
 * be adjusted without leaving the modal.
 */
export function FixPreviewModal({
  title,
  leverLabel,
  why,
  before,
  after,
  busy,
  onApply,
  onCancel,
}: FixPreviewModalProps): JSX.Element {
  const ref = useDialogA11y(true, onCancel);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(after);

  const segs = useMemo(() => trimContext(wordDiff(before, after)), [before, after]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm animate-fade-in p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Compare fix"
        className="nb-card w-[720px] max-w-full p-0 overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-rule flex items-center gap-2.5">
          {leverLabel && <span className="nb-pill nb-pill-empty shrink-0">{leverLabel}</span>}
          <h2 className="text-sm font-semibold text-ink truncate">{title}</h2>
          <button type="button" onClick={onCancel} className="nb-icon-btn ml-auto" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 max-h-[52vh] overflow-y-auto">
          <div className="px-5 py-4 border-b sm:border-b-0 sm:border-r border-rule">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-2">
              Original
            </p>
            <p className="font-serif text-[15px] leading-relaxed text-ink whitespace-pre-wrap">
              {segs
                .filter((s) => s.kind !== "added")
                .map((s, i) =>
                  s.kind === "removed" ? (
                    <del key={`${i}-${s.text.slice(0, 8)}`} className="bg-coral-soft text-coral-ink rounded-[3px] px-0.5 no-underline line-through">
                      {s.text}
                    </del>
                  ) : (
                    <span key={`${i}-${s.text.slice(0, 8)}`}>{s.text}</span>
                  ),
                )
                .reduce<JSX.Element[]>((acc, el, i) => (i ? [...acc, <span key={`sp${i}`}> </span>, el] : [el]), [])}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-2">
              AI rewrite
            </p>
            {editing ? (
              <textarea
                className="nb-input w-full text-[15px] font-serif min-h-[140px]"
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
              />
            ) : (
              <p className="font-serif text-[15px] leading-relaxed text-ink whitespace-pre-wrap">
                {segs
                  .filter((s) => s.kind !== "removed")
                  .map((s, i) =>
                    s.kind === "added" ? (
                      <mark key={`${i}-${s.text.slice(0, 8)}`} className="bg-green-soft text-green-ink rounded-[3px] px-0.5">
                        {s.text}
                      </mark>
                    ) : (
                      <span key={`${i}-${s.text.slice(0, 8)}`}>{s.text}</span>
                    ),
                  )
                  .reduce<JSX.Element[]>((acc, el, i) => (i ? [...acc, <span key={`sp${i}`}> </span>, el] : [el]), [])}
              </p>
            )}
          </div>
        </div>

        {why && (
          <p className="px-5 py-2.5 text-xs text-muted bg-card-2 border-t border-rule">
            Why: {why}
          </p>
        )}

        <footer className="px-5 py-3 border-t border-rule flex items-center justify-end gap-2">
          <button type="button" className="nb-btn nb-btn-ghost nb-btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {!editing && (
            <button
              type="button"
              className="nb-btn nb-btn-ghost nb-btn-sm"
              onClick={() => {
                setEdited(after);
                setEditing(true);
              }}
              disabled={busy}
            >
              Edit rewrite
            </button>
          )}
          <button
            type="button"
            className="nb-btn nb-btn-sm bg-cobalt-50 text-cobalt-800 border-cobalt-200"
            onClick={() => onApply(editing ? edited : after)}
            disabled={busy}
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

Note: if `bg-coral-soft`/`bg-green-soft`/`bg-card-2` don't exist in the Tailwind theme, check `packages/web/tailwind.config.*` for the closest tokens (`bg-amber-soft` exists; coral/green soft variants are used by IssueCard classes like `bg-green-soft text-green-ink` — verify and reuse whatever IssueCard uses).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run tests/components/review/FixPreviewModal.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/review/FixPreviewModal.tsx packages/web/tests/components/review/FixPreviewModal.test.tsx
git commit -m "feat(review): FixPreviewModal — side-by-side diff with edit-rewrite

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Preview phase in `useIssueLifecycle` + `persist:false` appliers

**Files:**
- Modify: `packages/web/src/components/review/useIssueLifecycle.ts`
- Modify: `packages/web/src/lib/issues/humanizeApply.ts`
- Modify: `packages/web/src/components/draft/geoApply.ts`
- Modify: `packages/web/src/components/draft/proofreadApply.ts`
- Test: `packages/web/tests/components/review/useIssueLifecycle.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests** (append to the existing describe block)

```tsx
// append inside describe("useIssueLifecycle", ...) in
// packages/web/tests/components/review/useIssueLifecycle.test.tsx

  it("requestPreview computes without saving; confirmPreview saves + accepts", async () => {
    const apply = vi.fn(
      async (): Promise<Applied> => ({ sectionId: "s1", before: "Old text.", after: "New text." }),
    );
    const save = vi.fn();
    const onRescore = vi.fn();
    const hook = renderHook(() =>
      useIssueLifecycle({ draftId: "d1", apply, save, onRescore }),
    );

    await act(async () => {
      await hook.result.current.requestPreview(issue, "ai_fix");
    });
    // Computed but NOT saved.
    expect(apply).toHaveBeenCalledWith(issue, "ai_fix", undefined, { persist: false });
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.preview?.res.after).toBe("New text.");

    await act(async () => {
      await hook.result.current.confirmPreview("New text.");
    });
    expect(save).toHaveBeenCalledWith("s1", "New text.", "content");
    expect(onRescore).toHaveBeenCalledWith("answer_first");
    expect(hook.result.current.statusOf(issue)).toBe("accepted");
    expect(hook.result.current.preview).toBeNull();
  });

  it("confirmPreview persists the user's edited rewrite", async () => {
    const apply = vi.fn(
      async (): Promise<Applied> => ({ sectionId: "s1", before: "Old.", after: "Suggested." }),
    );
    const save = vi.fn();
    const hook = renderHook(() => useIssueLifecycle({ draftId: "d1", apply, save }));
    await act(async () => {
      await hook.result.current.requestPreview(issue, "ai_fix");
    });
    await act(async () => {
      await hook.result.current.confirmPreview("My edited version.");
    });
    expect(save).toHaveBeenCalledWith("s1", "My edited version.", "content");
  });

  it("cancelPreview discards without saving and leaves the issue open", async () => {
    const apply = vi.fn(
      async (): Promise<Applied> => ({ sectionId: "s1", before: "Old.", after: "New." }),
    );
    const save = vi.fn();
    const hook = renderHook(() => useIssueLifecycle({ draftId: "d1", apply, save }));
    await act(async () => {
      await hook.result.current.requestPreview(issue, "ai_fix");
    });
    act(() => hook.result.current.cancelPreview());
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.statusOf(issue)).toBe("open");
  });

  it("undo still works after a previewed apply (ledger written on confirm)", async () => {
    const apply = vi.fn(
      async (): Promise<Applied> => ({ sectionId: "s1", before: "Old text.", after: "New text." }),
    );
    const save = vi.fn();
    const hook = renderHook(() => useIssueLifecycle({ draftId: "d1", apply, save }));
    await act(async () => {
      await hook.result.current.requestPreview(issue, "ai_fix");
      await hook.result.current.confirmPreview("New text.");
    });
    await act(async () => {
      await hook.result.current.undo(issue);
    });
    expect(save).toHaveBeenLastCalledWith("s1", "Old text.", "content");
    expect(hook.result.current.statusOf(issue)).toBe("open");
  });

  it("requestPreview surfaces apply errors via errorOf", async () => {
    const apply = vi.fn(async () => {
      throw new Error("This passage has changed since the pass ran.");
    });
    const hook = renderHook(() => useIssueLifecycle({ draftId: "d1", apply, save: vi.fn() }));
    await act(async () => {
      await hook.result.current.requestPreview(issue, "ai_fix");
    });
    expect(hook.result.current.errorOf(issue)).toMatch(/changed since/);
    expect(hook.result.current.preview).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web && npx vitest run tests/components/review/useIssueLifecycle.test.tsx`
Expected: FAIL — `requestPreview` is not a function

- [ ] **Step 3: Extend the apply contract and lifecycle**

In `packages/web/src/components/review/useIssueLifecycle.ts`:

1) Update the `apply` prop type in `UseIssueLifecycleArgs` (add the opts param):

```ts
  /** Perform the content change for an action; return null to no-op (e.g. a
   *  cancelled input). Persists the change itself UNLESS opts.persist is
   *  false (preview mode) — then it must compute and return the Applied
   *  without saving. The hook records undo either way. */
  apply: (
    issue: Issue,
    action: IssueAction,
    input?: string,
    opts?: { persist?: boolean },
  ) => Promise<Applied | null>;
```

2) Add preview state + the three methods inside the hook body (after the `run` callback):

```ts
  // ── Preview phase (AI fixes): compute → show modal → confirm/cancel ──
  const [preview, setPreview] = useState<{
    issue: Issue;
    action: IssueAction;
    res: Applied;
  } | null>(null);

  const requestPreview = useCallback(
    async (issue: Issue, action: IssueAction, input?: string): Promise<void> => {
      setBusy({ id: issue.id, action });
      setErrors((e) => {
        if (!e[issue.id]) return e;
        const next = { ...e };
        delete next[issue.id];
        return next;
      });
      try {
        const res = await apply(issue, action, input, { persist: false });
        if (res) setPreview({ issue, action, res });
      } catch (e) {
        setErrors((prev) => ({
          ...prev,
          [issue.id]: e instanceof Error ? e.message : "Couldn't compute this fix.",
        }));
      } finally {
        setBusy(null);
      }
    },
    [apply],
  );

  const confirmPreview = useCallback(
    async (finalAfter: string): Promise<void> => {
      if (!preview) return;
      const { issue, res } = preview;
      setBusy({ id: issue.id, action: "ai_fix" });
      try {
        const field = res.field ?? "content";
        await save(res.sectionId, finalAfter, field);
        const ledger = loadLedger(draftId);
        ledger[issue.id] = { sectionId: res.sectionId, before: res.before, lever: issue.lever, field };
        saveLedger(draftId, ledger);
        onRescore?.(issue.lever);
        // Preview already showed the compare — applied means done. Flash a
        // transient locate so the read pane shows where it landed.
        onHighlight?.(res.sectionId, res.highlight ?? null, "locate");
        setStatus((s) => ({ ...s, [issue.id]: "accepted" }));
        persistStatus(draftId, issue.id, "accepted");
        setPreview(null);
      } catch (e) {
        setErrors((prev) => ({
          ...prev,
          [issue.id]: e instanceof Error ? e.message : "Couldn't apply this fix.",
        }));
        setPreview(null);
      } finally {
        setBusy(null);
      }
    },
    [preview, draftId, save, onHighlight, onRescore],
  );

  const cancelPreview = useCallback((): void => setPreview(null), []);
```

3) Extend the return:

```ts
  return {
    statusOf,
    errorOf,
    busyId,
    busyAction,
    run,
    accept,
    undo,
    preview,
    requestPreview,
    confirmPreview,
    cancelPreview,
  };
```

4) In each apply factory, honor `persist:false`. The pattern — compute `after` as today, then:

`packages/web/src/lib/issues/humanizeApply.ts` — change `makeHumanizeApply`'s returned function signature and final lines:

```ts
  return async (issue, action, input, opts) => {
    // ... existing body unchanged until the save ...
    if (opts?.persist !== false) await onSectionSave(issue.sectionId, after, true);
    return { sectionId: issue.sectionId, before, after, highlight: replacement, field };
  };
```

`packages/web/src/components/draft/geoApply.ts` — same idea. The function currently saves inside each case via a local helper or direct `saveContent(...)` calls before returning `{sectionId, before, after, ...}`. Introduce at the top of the returned async fn:

```ts
  return async (issue: Issue, action: IssueAction, input?: string, opts?: { persist?: boolean }) => {
    const persist = opts?.persist !== false;
```

and gate every persist call: where a case currently does `await saveContent(sectionId, after)` (or the field-specific saver) before `return {...}`, wrap it: `if (persist) await saveContent(sectionId, after);`. Every `case` keeps returning the same `Applied`. (There are saves in the `ai_fix`, `manual_fix`, generate/weave cases — gate them all; `dismiss` has none.)

`packages/web/src/components/draft/proofreadApply.ts` — same: add the `opts` param, and gate its single save call at the end (`if (opts?.persist !== false) await onSectionSave(...)`) before `return { sectionId: section.id, before, after, highlight: replacement }`.

- [ ] **Step 4: Run the lifecycle + apply tests**

Run: `cd packages/web && npx vitest run tests/components/review/useIssueLifecycle.test.tsx tests/lib/issues/humanizeApply.test.ts && npx tsc --noEmit`
Expected: PASS (existing 9 + new 5; humanizeApply 4), tsc clean

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/review/useIssueLifecycle.ts packages/web/src/lib/issues/humanizeApply.ts packages/web/src/components/draft/geoApply.ts packages/web/src/components/draft/proofreadApply.ts packages/web/tests/components/review/useIssueLifecycle.test.tsx
git commit -m "feat(review): preview phase — compute fixes without saving, confirm to apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the modal into the three rails

**Files:**
- Modify: `packages/web/src/components/draft/HumanizeReviewRail.tsx`
- Modify: `packages/web/src/components/draft/GeoReviewRail.tsx`
- Modify: `packages/web/src/components/draft/ProofreadReviewRail.tsx`
- Test: `packages/web/tests/components/HumanizePanel.test.tsx` (extend — panel-level integration)

- [ ] **Step 1: Write the failing integration test** (append to HumanizePanel.test.tsx; the mock report in "shows the radar and heat-maps a flagged finding" provides the pattern for a findings-bearing report)

```tsx
  it("AI fix opens the preview modal; Apply saves; nothing saves before Apply", async () => {
    (analyzeHumanize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      intensity: "medium",
      score: 85,
      lenses: [
        {
          key: "soul",
          label: "De-robot / Soul",
          findings: [
            {
              lens: "soul",
              section_id: "s1",
              target: "The API serves as a gateway.",
              suggestion: "The API is the gateway.",
              note: "puffery",
              needs_review: false,
            },
          ],
        },
      ],
    });
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    // biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
    const d: any = {
      id: "d1",
      title: "T",
      outline: { opening_hook: "h" },
      sections: [{ id: "s1", title: "S", content_md: "The API serves as a gateway. It adds 5ms." }],
    };
    render(<HumanizePanel draft={d} onSectionSave={onSectionSave} onClose={vi.fn()} />);

    const aiFix = await screen.findByRole("button", { name: "AI fix" });
    fireEvent.click(aiFix);

    // Modal opens; the draft has NOT been touched yet.
    const dialog = await screen.findByRole("dialog", { name: /compare fix/i });
    expect(onSectionSave).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Original")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onSectionSave).toHaveBeenCalledWith(
        "s1",
        "The API is the gateway. It adds 5ms.",
        true,
      ),
    );
  });
```

Add `within` to the testing-library import at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/web && npx vitest run tests/components/HumanizePanel.test.tsx`
Expected: FAIL — no dialog "Compare fix" appears (ai_fix still applies directly)

- [ ] **Step 3: Wire each rail**

Pattern (shown for `HumanizeReviewRail.tsx`; GEO and Proofread are the same three edits):

1) Import the modal:

```ts
import { FixPreviewModal } from "../review/FixPreviewModal";
```

2) Destructure the new lifecycle pieces:

```ts
  const {
    statusOf, errorOf, busyId, busyAction, run, accept, undo,
    preview, requestPreview, confirmPreview, cancelPreview,
  } = useIssueLifecycle({ ... });   // args unchanged per rail
```

3) Route `ai_fix` through the preview. In HumanizeReviewRail's `handleAction`:

```ts
  const handleAction = (issue: Issue, action: IssueAction, input?: string): void => {
    if (action === "dismiss") {
      setDismissedIds(dismissFinding(draft.id, issue.id));
      return;
    }
    if (action === "ai_fix") {
      void requestPreview(issue, action, input);
      return;
    }
    void run(issue, action, input);
  };
```

In GeoReviewRail and ProofreadReviewRail the IssueCard `onAction` currently calls `void run(issue, action, inputText)` directly — replace with:

```ts
  onAction={(action, inputText) =>
    action === "ai_fix"
      ? void requestPreview(issue, action, inputText)
      : void run(issue, action, inputText)
  }
```

4) Render the modal after the card list (per rail, inside the returned fragment):

```tsx
      {preview && (
        <FixPreviewModal
          title={preview.issue.title}
          leverLabel={leverLabelFor(preview.issue.lever)}
          why={preview.issue.why}
          before={preview.res.before}
          after={preview.res.after}
          busy={busyId === preview.issue.id && busyAction === "ai_fix"}
          onApply={(finalAfter) => void confirmPreview(finalAfter)}
          onCancel={cancelPreview}
        />
      )}
```

with a tiny per-rail label helper:

- HumanizeReviewRail: `const leverLabelFor = (key: string): string => report.lenses.find((l) => l.key === key)?.label ?? key;`
- GeoReviewRail: `const leverLabelFor = (key: string): string => report.levers.find((l) => l.key === key)?.label ?? key;`
- ProofreadReviewRail: `const leverLabelFor = (): string => "Proofread";`

- [ ] **Step 4: Run panel test + full suite + tsc**

Run: `cd packages/web && npx vitest run tests/components/HumanizePanel.test.tsx && npm test && npx tsc --noEmit`
Expected: all PASS. If `GeoReviewRail.test.tsx` asserts the old direct-apply behavior for ai_fix, update that test to expect the modal (same pattern as Step 1).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/draft/HumanizeReviewRail.tsx packages/web/src/components/draft/GeoReviewRail.tsx packages/web/src/components/draft/ProofreadReviewRail.tsx packages/web/tests/components/HumanizePanel.test.tsx packages/web/tests/components/GeoReviewRail.test.tsx
git commit -m "feat(review): AI fix opens the compare modal on all three rails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Staccato-pairs AI-tell (backend)

**Files:**
- Modify: `packages/api/blogforge/voice/lint.py` (regexes near the other `_AI_*` patterns; spec in `detect_ai_patterns`)
- Modify: `packages/api/blogforge/voice/assets/ai-tells/patterns.md`
- Modify: `packages/api/blogforge/generate/humanize.py` (flow rubric)
- Test: `packages/api/tests/voice/test_lint.py` (or wherever existing `detect_ai_patterns` tests live — `grep -rn "detect_ai_patterns" packages/api/tests/` and extend that file)

- [ ] **Step 1: Write the failing tests** (append to the file containing existing detect_ai_patterns tests)

```python
def test_staccato_pairs_run_flagged():
    text = (
        "The platform handles this well. Isolation and security. Cost and control. "
        "As well as speed and scale. The rest of the post explains how."
    )
    hits = detect_ai_patterns(text)
    ids = [h.rule_id for h in hits]
    assert "ai_pattern:staccato_pairs" in ids


def test_single_pair_sentence_not_flagged():
    text = "We measured cost and control. Then we moved on to the deployment story in detail."
    hits = detect_ai_patterns(text)
    assert all(h.rule_id != "ai_pattern:staccato_pairs" for h in hits)


def test_long_sentences_with_and_not_flagged():
    text = (
        "The platform gives you the deployment surface and the credential story you already "
        "trust. It also gives you the network policy and the audit trail your team asked for."
    )
    hits = detect_ai_patterns(text)
    assert all(h.rule_id != "ai_pattern:staccato_pairs" for h in hits)


def test_as_well_as_sentence_start_flagged():
    text = "You get sandboxes. As well as full logging for every call."
    hits = detect_ai_patterns(text)
    assert any(h.rule_id == "ai_pattern:staccato_pairs" for h in hits)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && uv run pytest tests/ -k staccato -q`
Expected: FAIL (rule id never emitted)

- [ ] **Step 3: Implement the detector**

In `voice/lint.py`, near the other `_AI_*` regexes add:

```python
# Staccato paired-list runs — "Isolation and security. Cost and control. As
# well as speed and scale." Two+ consecutive short bare-pair sentences (a
# single "and", no other connective) read as a chopped-up list; humans vary
# the joinery. Also flags any sentence STARTING "As well as" (a fragment
# masquerading as a sentence).
_PAIR_SENTENCE = re.compile(
    r"^[A-Z][\w'’-]*(?:\s+[\w'’-]+){0,4}\s+and\s+[\w'’-]+(?:\s+[\w'’-]+){0,4}[.!?]$"
)
_AS_WELL_AS_START = re.compile(r"(?m)(?:^|(?<=[.!?]\s))As well as\b[^.!?]*[.!?]")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
```

Then extend `detect_ai_patterns` (after the existing spec loop):

```python
    # Staccato pair runs: walk sentences, flag a run of >=2 consecutive
    # bare-pair sentences (each <=12 words, single "and").
    sentences: list[tuple[int, str]] = []
    pos = 0
    for part in _SENT_SPLIT.split(text):
        idx = text.find(part, pos)
        if idx >= 0:
            sentences.append((idx, part.strip()))
            pos = idx + len(part)
    run_start: int | None = None
    run_len = 0
    for idx, sent in [*sentences, (len(text), "")]:
        words = sent.split()
        is_pair = bool(sent) and len(words) <= 12 and bool(_PAIR_SENTENCE.match(sent))
        if is_pair:
            if run_start is None:
                run_start = idx
            run_len += 1
            run_end = idx + len(sent)
        else:
            if run_start is not None and run_len >= 2:
                hits.append(LintHit(
                    start=_utf16_offset(text, run_start),
                    end=_utf16_offset(text, run_end),
                    kind="rule",
                    rule_id="ai_pattern:staccato_pairs",
                    message="Staccato paired-list run — connect the ideas or use a real list.",
                ))
            run_start = None
            run_len = 0

    for m in _AS_WELL_AS_START.finditer(text):
        hits.append(LintHit(
            start=_utf16_offset(text, m.start()),
            end=_utf16_offset(text, m.end()),
            kind="rule",
            rule_id="ai_pattern:staccato_pairs",
            message='Sentence fragment starting "As well as" — fold it into the previous sentence.',
        ))
    return hits
```

(The existing `return hits` at the end of the function is replaced by this block ending in `return hits`.)

- [ ] **Step 4: Add the compose-side rule**

Append to `voice/assets/ai-tells/patterns.md` (match the existing bullet style):

```markdown
- **Don't chop a list into paired fragments.** Avoid runs like "Isolation and security. Cost and control. As well as speed and scale." — uniform "X and Y." sentences are a list wearing punctuation. Connect the ideas with real logic, vary the sentence shapes, or use an actual list. Never start a sentence with "As well as".
```

- [ ] **Step 5: Name the pattern in the Humanize flow rubric**

In `generate/humanize.py`, find the flow lens rubric text (search for the string the flow lens uses — `grep -n "metronome\|rhythm\|Flow" generate/humanize.py`) and append one sentence to the flow rubric:

```
Also flag staccato paired-list runs — consecutive short "X and Y." sentences
(or fragments starting "As well as") that chop a list into uniform pieces.
```

- [ ] **Step 6: Run the API tests**

Run: `cd packages/api && uv run pytest tests/ -k "staccato or ai_pattern or lint" -q`
Expected: PASS (new 4 + all existing lint tests)

- [ ] **Step 7: Commit**

```bash
git add packages/api/blogforge/voice/lint.py packages/api/blogforge/voice/assets/ai-tells/patterns.md packages/api/blogforge/generate/humanize.py packages/api/tests/
git commit -m "feat(lint): detect staccato paired-list runs as an AI tell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: GEO impact field (backend)

**Files:**
- Modify: `packages/api/blogforge/generate/geo.py`
- Test: `packages/api/tests/generate/test_geo.py` (find with `grep -rln "parse_semantic" packages/api/tests/`)

- [ ] **Step 1: Write the failing tests**

```python
def test_parse_semantic_carries_impact(sample_draft):
    raw = json.dumps({
        "answer_first": {"score": 50, "note": "buried", "weak_sections": ["Intro"]},
        "definitional_opener": {"score": 80, "note": "ok", "has_definition": True},
        "factual_density": {
            "score": 40, "note": "thin",
            "thin_spots": [{
                "target": "It is very fast.",
                "note": "vague",
                "suggestion": "Add a p95 latency number",
                "impact": "Engines lift passages with concrete numbers into answers.",
            }],
        },
        "brand_explicit": {"score": 70, "note": "named"},
        "citations": {"score": 30, "note": "none"},
    })
    levers = parse_semantic(raw, sample_draft)
    thin = levers["factual_density"]["findings"][0]
    assert thin["impact"] == "Engines lift passages with concrete numbers into answers."


def test_structural_levers_carry_static_impact(sample_draft):
    levers = score_structural(sample_draft)
    for key, lever in levers.items():
        assert lever.get("impact"), f"structural lever {key} missing impact copy"
```

(Use the existing `sample_draft` fixture/pattern from that test file; if the fixture has a different name, reuse whatever the surrounding tests use.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && uv run pytest tests/ -k "impact" -q`
Expected: FAIL

- [ ] **Step 3: Implement**

1) Static per-lever impact copy for ALL levers (used by lever headers and as the finding fallback). Add after `_LABELS`:

```python
# One concrete sentence of GEO mechanism per lever — WHY the lever moves
# citations, shown on lever headers and as the fallback for findings whose
# semantic pass didn't supply a per-finding impact.
_IMPACTS: dict[str, str] = {
    "answer_first": "Answer engines quote the first 40-60 words of a section; burying the answer means they quote someone else's page.",
    "factual_density": "Passages with concrete numbers are what engines lift into answers — vague claims get skipped.",
    "citations": "Claims with named sources are trusted and cited; unattributed claims get filtered as unverifiable.",
    "definitional_opener": "A one-line definition up top is the single most-extracted sentence shape for 'what is X' queries.",
    "question_headings": "Question headings match how users phrase queries — engines map query to heading directly.",
    "skimmability": "Engines parse structure; walls of prose fragment poorly into answer passages.",
    "brand_explicit": "AI can cite content without naming you ('ghost citation') — an explicit brand travels with the quote.",
    "faq": "FAQ blocks map one-to-one onto the question formats answer engines serve.",
    "chunking": "Each passage is extracted alone — a chunk that leans on its neighbors loses its meaning when lifted.",
    "takeaways": "Key-takeaways blocks are pre-digested summaries engines prefer over synthesizing their own.",
    "freshness": "Dated claims signal current content; engines demote pieces they can't place in time.",
    "comparison_table": "Tables answer 'X vs Y' queries directly — engines lift rows verbatim.",
}
```

2) Extend `_lever(...)` to carry it:

```python
        "detail": detail,
        "impact": _IMPACTS.get(key, ""),
        "findings": findings or [],
```

3) In `_SEMANTIC_SCHEMA`, add `"impact": {"type": "string"}` to the item properties of `factual_density.thin_spots` and `citations.uncited_claims`, and add a top-level `"impact": {"type": "string"}` property to each of the five lever objects.

4) In `_SEMANTIC_DIRECTIVE`, append one instruction:

```
For every finding and every lever, also return `impact`: ONE concrete sentence
of GEO mechanism — what this specifically does to the piece's chances of being
quoted by an answer engine. State the payoff, never restate the fix.
```

5) In `parse_semantic`, wherever findings dicts are built (weak-section findings, `thin_spots`, `uncited_claims`), carry `"impact": str(item.get("impact", "")).strip()` through, and default each finding's impact to the lever's `_IMPACTS[key]` when empty. Follow the existing dict-building pattern in each block.

- [ ] **Step 4: Run**

Run: `cd packages/api && uv run pytest tests/ -k "geo" -q`
Expected: PASS (new 2 + existing geo tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/geo.py packages/api/tests/
git commit -m "feat(geo): every lever and finding carries a concrete GEO impact line

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Eight new GEO levers (backend)

**Files:**
- Modify: `packages/api/blogforge/generate/geo.py`
- Test: same geo test file as Task 6

- [ ] **Step 1: Write the failing tests**

```python
def test_weights_sum_to_one():
    assert abs(sum(_WEIGHTS.values()) - 1.0) < 1e-9


def test_new_levers_registered():
    new = {"stat_attribution", "query_coverage", "sound_bites", "entity_consistency",
           "experience_signals", "jargon_defined", "concrete_examples", "title_shape"}
    assert new <= set(_WEIGHTS) and new <= set(_LABELS) and new <= set(_ORDER)
    assert new <= _SEMANTIC_KEYS


def test_parse_semantic_maps_new_lever_findings(sample_draft):
    raw = json.dumps({
        "answer_first": {"score": 50, "note": "x", "weak_sections": []},
        "definitional_opener": {"score": 80, "note": "x", "has_definition": True},
        "factual_density": {"score": 40, "note": "x"},
        "brand_explicit": {"score": 70, "note": "x"},
        "citations": {"score": 30, "note": "x"},
        "sound_bites": {
            "score": 45, "note": "few liftable lines",
            "findings": [{
                "target": "This whole paragraph rambles toward its point.",
                "note": "No self-contained quotable line in this section.",
                "suggestion": "Distill the point into one sentence under 25 words.",
                "impact": "Engines lift single self-contained sentences verbatim.",
            }],
        },
    })
    levers = parse_semantic(raw, sample_draft)
    sb = levers["sound_bites"]
    assert sb["score"] == 45
    assert sb["findings"][0]["suggestion"].startswith("Distill")
    assert sb["findings"][0]["impact"]
```

Import `_WEIGHTS`, `_LABELS`, `_ORDER`, `_SEMANTIC_KEYS` in the test file's imports from `blogforge.generate.geo`.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && uv run pytest tests/ -k "new_lever or weights_sum" -q`
Expected: FAIL

- [ ] **Step 3: Implement**

1) `_WEIGHTS` — replace the dict wholesale (spec weights, sums to 1.00):

```python
_WEIGHTS: dict[str, float] = {
    "answer_first": 0.13,
    "factual_density": 0.13,
    "citations": 0.09,
    "definitional_opener": 0.06,
    "question_headings": 0.06,
    "skimmability": 0.06,
    "brand_explicit": 0.04,
    "faq": 0.04,
    "chunking": 0.04,
    "takeaways": 0.04,
    "freshness": 0.04,
    "comparison_table": 0.03,
    "stat_attribution": 0.04,
    "query_coverage": 0.04,
    "sound_bites": 0.03,
    "entity_consistency": 0.03,
    "experience_signals": 0.03,
    "jargon_defined": 0.03,
    "concrete_examples": 0.02,
    "title_shape": 0.02,
}
```

2) `_ORDER` — insert the new keys after `citations` by leverage: `"stat_attribution", "query_coverage",` then keep existing order, appending `"sound_bites", "entity_consistency", "experience_signals", "jargon_defined", "concrete_examples", "title_shape"` before `"chunking", "faq"` (exact order is display-only; keep all 20 present).

3) `_LABELS` and `_IMPACTS` — add the eight:

```python
    "stat_attribution": "Stats tied to sources",
    "query_coverage": "Covers follow-up questions",
    "sound_bites": "Liftable sound bites",
    "entity_consistency": "Consistent entity names",
    "experience_signals": "First-hand experience",
    "jargon_defined": "Jargon defined on first use",
    "concrete_examples": "Worked examples",
    "title_shape": "Title shape",
```

```python
    "stat_attribution": "A number tied to a named source is a citable fact; a bare number is just a claim.",
    "query_coverage": "Answering the follow-up questions keeps the engine on your page instead of blending in a competitor's.",
    "sound_bites": "Engines lift single self-contained sentences verbatim — give them one worth lifting.",
    "entity_consistency": "One canonical name per thing is how engines resolve WHO the piece is about; aliases dilute the entity.",
    "experience_signals": "First-hand evidence ('we measured') is the E in E-E-A-T — generic AI content can't fake it.",
    "jargon_defined": "A term defined on first use keeps the passage self-contained when extracted alone.",
    "concrete_examples": "How-to queries surface pages with worked examples; claims without one lose to pages that show it.",
    "title_shape": "A how-to/number/year hook under 60 chars survives the SERP truncation and matches query templates.",
```

4) `_SEMANTIC_KEYS` — add all eight to the frozenset.

5) `_SEMANTIC_SCHEMA` — add one generic lever schema per new key (shared shape). Define once above the schema:

```python
_GENERIC_LEVER_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "score": {"type": "integer"},
        "note": {"type": "string"},
        "impact": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "note": {"type": "string"},
                    "suggestion": {"type": "string"},
                    "impact": {"type": "string"},
                },
                "required": ["note"],
            },
        },
    },
    "required": ["score", "note"],
}

_NEW_SEMANTIC_KEYS = (
    "stat_attribution", "query_coverage", "sound_bites", "entity_consistency",
    "experience_signals", "jargon_defined", "concrete_examples", "title_shape",
)
```

and in `_SEMANTIC_SCHEMA["properties"]` add `**{k: _GENERIC_LEVER_SCHEMA for k in _NEW_SEMANTIC_KEYS}` (spread inline or assign after the literal: `_SEMANTIC_SCHEMA["properties"].update({k: _GENERIC_LEVER_SCHEMA for k in _NEW_SEMANTIC_KEYS})`). Do NOT add them to `required` — parse tolerates absence.

6) `_SEMANTIC_DIRECTIVE` — append eight numbered rubrics:

```
"6) stat_attribution: are numbers tied INLINE to a named source ('per Gartner, "
"2025')? A bare number is a claim; a sourced number is a citable fact. Flag "
"unattributed stats in `findings` (quote each in `target`).\n"
"7) query_coverage: does the piece answer the adjacent questions a reader asks "
"next (cost? limits? alternatives? prerequisites?)? Flag the biggest gaps as "
"findings (note = the missing question, suggestion = where it would fit).\n"
"8) sound_bites: does it contain >=2 self-contained one-sentence statements "
"under 25 words an engine could quote verbatim? Flag sections whose point never "
"lands in one liftable line.\n"
"9) entity_consistency: is each product/technology called ONE canonical name "
"throughout? Flag alias drift ('TP', 'the platform') in findings with the "
"canonical name in `suggestion`.\n"
"10) experience_signals: does the author show first-hand experience ('we "
"measured', 'when I ran this', a real result)? Flag sections that read as "
"secondhand summary.\n"
"11) jargon_defined: is every specialist term given a short appositive "
"definition on first use? Flag undefined first-uses (term in `target`).\n"
"12) concrete_examples: are how-to claims backed by a worked example or code "
"block? Flag claims that assert without showing.\n"
"13) title_shape: does the H1 carry a how-to/number/year hook and stay under "
"60 characters? Score the title's SERP shape; suggest a sharper title in "
"`suggestion` if weak. The draft's title is the first line of the document.\n"
"For all findings everywhere: `target` must be VERBATIM text from the draft "
"when it refers to a passage; omit `target` for document-level findings.\n"
```

7) `parse_semantic` — add a generic mapping block before the final return (mirroring how existing levers build finding dicts; section resolution is left to the frontend's `fillSectionIds`, so omit `section_id`):

```python
    for key in _NEW_SEMANTIC_KEYS:
        obj = data.get(key) if isinstance(data.get(key), dict) else {}
        finds: list[dict[str, str]] = []
        for f in (obj.get("findings") or [])[:4]:
            if not isinstance(f, dict) or not str(f.get("note", "")).strip():
                continue
            finds.append({
                k: str(f.get(k, "")).strip()
                for k in ("target", "note", "suggestion", "impact")
                if str(f.get(k, "")).strip()
            })
            if "impact" not in finds[-1]:
                finds[-1]["impact"] = _IMPACTS.get(key, "")
        out[key] = _lever(key, _clampi(obj.get("score")), str(obj.get("note", "")).strip(), finds)
```

(`out` is whatever dict name parse_semantic accumulates levers in — match the existing variable.)

- [ ] **Step 4: Run the full geo test file**

Run: `cd packages/api && uv run pytest tests/ -k "geo" -q`
Expected: PASS. If an existing test asserts a specific old weight value (e.g. answer_first == 0.16), update it to the new value.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/generate/geo.py packages/api/tests/
git commit -m "feat(geo): eight new levers — stat attribution, query coverage, sound bites, entities, E-E-A-T, jargon, examples, title shape

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Frontend impact display

**Files:**
- Modify: `packages/web/src/api/geo.ts` (types: `impact?: string` on finding + lever)
- Modify: `packages/web/src/lib/issues/types.ts` (`impact?: string` on Issue)
- Modify: `packages/web/src/lib/issues/geoAdapter.ts`
- Modify: `packages/web/src/components/review/IssueCard.tsx`
- Modify: `packages/web/src/components/draft/GeoReviewRail.tsx` (lever header "up to N pts")
- Test: `packages/web/tests/lib/issues/geoAdapter.test.ts` and `packages/web/tests/components/GeoReviewRail.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `geoAdapter.test.ts` (mirror its existing report fixture shape):

```ts
  it("maps finding impact, falling back to the lever impact", () => {
    const report = {
      score: 50,
      grade: "C",
      levers: [{
        key: "sound_bites",
        label: "Liftable sound bites",
        score: 45,
        weight: 0.03,
        detail: "few",
        impact: "Engines lift single sentences verbatim.",
        fix: null,
        findings: [
          { note: "no liftable line", target: "x", impact: "Specific impact." },
          { note: "another", target: "y" },
        ],
      }],
    } as unknown as GeoReport;
    const issues = geoFindingsToIssues(report);
    expect(issues[0].impact).toBe("Specific impact.");
    expect(issues[1].impact).toBe("Engines lift single sentences verbatim.");
  });
```

Append to `GeoReviewRail.test.tsx` (reuse its render helper/fixtures):

```ts
  it("shows the impact line on a finding card and points on the lever header", () => {
    // extend the fixture lever with weight: 0.13 and impact strings as above,
    // then:
    expect(screen.getByText(/up to 13 pts/i)).toBeInTheDocument();
    expect(screen.getByText(/GEO: Engines lift/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/web && npx vitest run tests/lib/issues/geoAdapter.test.ts tests/components/GeoReviewRail.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

1) `api/geo.ts` — add `impact?: string` to the `GeoFinding` interface and the lever type (`GeoLever` or the inline lever shape in `GeoReport`).

2) `lib/issues/types.ts` — add to `Issue`:

```ts
  /** One-sentence concrete payoff (GEO panel: why this moves citations). */
  impact?: string;
```

3) `geoAdapter.ts` — in the per-finding push add `impact: finding.impact || lever.impact,` and in the lever-level synthesized issue add `impact: lever.impact,`.

4) `IssueCard.tsx` — render it in the open state, after the `issue.why` paragraph:

```tsx
      {issue.impact && (
        <p className="text-[12px] leading-snug ml-4 mb-1.5 text-cobalt-700 italic">
          GEO: {issue.impact}
        </p>
      )}
```

5) `GeoReviewRail.tsx` — the lever group header (where `lever.label` renders) gains a stakes chip. Find the lever-section header in the by-lever render and append:

```tsx
  <span className="text-[11px] text-muted-2 font-normal ml-2">
    up to {Math.round(lever.weight * 100)} pts
  </span>
```

(The rail groups by lever key; it needs the lever object — it already has `report.levers`, so look up `report.levers.find((l) => l.key === leverKey)` where the header renders.)

- [ ] **Step 4: Run**

Run: `cd packages/web && npx vitest run tests/lib/issues/geoAdapter.test.ts tests/components/GeoReviewRail.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/geo.ts packages/web/src/lib/issues/types.ts packages/web/src/lib/issues/geoAdapter.ts packages/web/src/components/review/IssueCard.tsx packages/web/src/components/draft/GeoReviewRail.tsx packages/web/tests/
git commit -m "feat(geo): show per-finding GEO impact lines and lever point stakes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Citations use attached sources first

**Files:**
- Modify: `packages/api/blogforge/generate/geo.py` (`_run_semantic`, `analyze_geo`, `rescore_geo` signatures; citations schema + directive)
- Modify: `packages/api/blogforge/api/geo.py` (pass references/sources context)
- Modify: `packages/web/src/components/draft/geoApply.ts` (splice path when suggestion present)
- Test: geo test file (backend) + `packages/web/tests/components/geoApply.test.ts` (extend)

- [ ] **Step 1: Write the failing backend test**

```python
def test_semantic_prompt_includes_attached_sources(sample_draft, monkeypatch):
    captured: dict[str, str] = {}

    class FakeProvider:
        async def complete(self, *, model, prompt, json_schema=None):
            captured["prompt"] = prompt
            class R:
                text = "{}"
            return R()

    sample_draft.references = [
        SimpleNamespace(title="Tanzu 10.4 release notes",
                        url="https://docs.vmware.com/tanzu-10-4", kind="url"),
    ]
    import asyncio
    asyncio.get_event_loop().run_until_complete(
        _run_semantic(sample_draft, tmp_pack_root, FakeProvider(), model="m")
    )
    assert "Tanzu 10.4 release notes" in captured["prompt"]
    assert "ATTACHED SOURCES" in captured["prompt"]
```

(Adapt fixture names — `tmp_pack_root` should be whatever existing `_run_semantic`/`analyze_geo` tests use for a pack root; follow the surrounding test file's conventions, including any asyncio marker style like `@pytest.mark.asyncio`. Check `draft.references` item type in `blogforge/drafts/models.py` — use the real model instead of SimpleNamespace if references are typed objects.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && uv run pytest tests/ -k "attached_sources" -q`
Expected: FAIL

- [ ] **Step 3: Implement backend**

1) Give `_run_semantic`, `analyze_geo`, and `rescore_geo` an optional `extra_sources: str = ""` keyword param (threaded straight through). In `_run_semantic`, after building `system`, render the attached sources block and include it in the prompt:

```python
    refs = getattr(draft, "references", None) or []
    sources_block = ""
    lines = "\n".join(f"- {r.title or r.url}: {r.url}" for r in refs)
    if lines or extra_sources:
        sources_block = (
            "\n\nATTACHED SOURCES (the author already collected these — use them FIRST):\n"
            f"{lines}\n{extra_sources}\n"
        )
```

and append `sources_block` into the prompt string right after `_SEMANTIC_DIRECTIVE` (before the DRAFT section).

1b) In `api/geo.py`, both the `geo_report` and rescore endpoints build the profile background-sources context and pass it through (mirrors `api/expand.py`'s usage):

```python
    from blogforge.voice.sources_context import build_background_context

    bg = await build_background_context(current.id)
    return await analyze_geo(
        draft, pack_root, manifest, provider, model=draft.idea.model, extra_sources=bg or ""
    )
```

(`build_background_context` returns prose describing the profile's background sources; if its output is long, that's fine — it rides in the sources block. Check its exact signature in `voice/sources_context.py` before wiring; `api/expand.py:138-141` shows the working call pattern.)

2) Replace the citations rubric (item 5 in `_SEMANTIC_DIRECTIVE`) with:

```
"5) citations: do concrete, checkable claims carry a source? FIRST match each "
"uncited claim against the ATTACHED SOURCES list if one is provided: when a "
"claim matches an attached source, emit a finding whose `note` names the "
"source ('matches your attached: <title>'), whose `matched_source_url` is its "
"URL, and whose `suggestion` is the claim sentence REWRITTEN VERBATIM with the "
"markdown link inserted at the natural anchor text. Only for claims NO "
"attached source covers, describe the specific KIND of source to find (e.g. "
"'a dated benchmark for the latency claim') — never a generic 'add sources'. "
"When sources are attached, `note` on the lever should acknowledge them "
"('N sources attached; M cited in-text'). Never invent sources.\n"
```

3) In `_SEMANTIC_SCHEMA`, extend `citations.uncited_claims` item properties with `"suggestion": {"type": "string"}` and `"matched_source_url": {"type": "string"}`.

4) In `parse_semantic`'s citations block, carry `suggestion` and `matched_source_url` through onto the finding dicts (same string-strip pattern as other fields).

- [ ] **Step 4: Frontend splice path**

In `geoApply.ts`'s `ai_fix` case, BEFORE the `inlineEdit` model call, add a precomputed-suggestion fast path (mirrors Humanize):

```ts
      case "ai_fix": {
        // Citation matches (and any finding that ships its rewrite) carry a
        // precomputed suggestion — splice it client-side, no model call.
        if (issue.suggestion && issue.target && before.includes(issue.target)) {
          const after = before.replace(issue.target, issue.suggestion);
          if (persist) await saveContent(sectionId, after);
          return { sectionId, before, after, highlight: issue.suggestion, field };
        }
        // ... existing inlineEdit path unchanged
```

And in `geoAdapter.ts`, map `suggestion: finding.suggestion` onto the issue (add `suggestion?: string` to the GeoFinding type in `api/geo.ts` if absent).

Frontend test (append to the geoApply test file, following its fixture pattern):

```ts
  it("ai_fix with a precomputed suggestion splices without a model call", async () => {
    // draft section content: "Latency dropped 40% after the change."
    // issue: { target: "Latency dropped 40% after the change.",
    //          suggestion: "Latency dropped 40% ([Tanzu 10.4 release notes](https://docs...)) after the change.",
    //          actions: ["ai_fix"], lever: "citations", ... }
    const res = await apply(issueWithSuggestion, "ai_fix");
    expect(inlineEdit).not.toHaveBeenCalled();
    expect(res?.after).toContain("[Tanzu 10.4 release notes]");
  });
```

- [ ] **Step 5: Run both sides**

Run: `cd packages/api && uv run pytest tests/ -k "geo or attached" -q && cd ../web && npx vitest run tests/components/geoApply.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/generate/geo.py packages/api/blogforge/api/geo.py packages/api/tests/ packages/web/src/components/draft/geoApply.ts packages/web/src/lib/issues/geoAdapter.ts packages/web/src/api/geo.ts packages/web/tests/
git commit -m "feat(geo): citation findings match attached sources first, with one-click cite

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Voice — fingerprint into compose, distill v2, exemplars

**Files:**
- Modify: `packages/api/blogforge/voice/fingerprint.py` (add `render_fingerprint_md`, `select_exemplars`)
- Modify: `packages/api/blogforge/voice/pack.py` (`materialize` writes `fingerprint.md` + `exemplars.md`)
- Modify: `packages/api/blogforge/voice/compose.py` (include both files when present)
- Modify: `packages/api/blogforge/voice/distill.py` (v2 prompt)
- Test: `packages/api/tests/voice/` (fingerprint + pack + compose test files — find with `grep -rln "compute_stats\|materialize\|compose_prompt" packages/api/tests/`)

- [ ] **Step 1: Write the failing tests**

```python
def test_render_fingerprint_md_summarizes_rhythm_and_phrases():
    texts = [
        "Short one. Another short one. Here is a much longer sentence that keeps "
        "going to stretch the average out considerably for the test. Short again. "
        "Here's the thing. Here's the thing about rhythm in real writing samples."
    ]
    md = render_fingerprint_md(texts)
    assert "## Voice fingerprint" in md
    assert "short" in md.lower()          # rhythm mix mentions short sentences
    assert "here's the thing" in md.lower()  # signature phrase surfaces


def test_select_exemplars_picks_distinct_short_excerpts():
    a = "First sample. " * 40
    b = "Second sample entirely different words. " * 40
    ex = select_exemplars([a, b], k=2, max_chars=300)
    assert len(ex) == 2
    assert all(len(e) <= 300 for e in ex)
    assert ex[0] != ex[1]


def test_materialize_writes_fingerprint_and_exemplars(profile_with_samples, tmp_path, monkeypatch):
    # reuse the existing materialize test fixtures/monkeypatching in this file
    pack_dir = await_materialize(profile_with_samples)  # follow existing pattern
    assert (pack_dir / "fingerprint.md").is_file()
    assert (pack_dir / "exemplars.md").is_file()


def test_compose_prompt_includes_fingerprint_and_exemplars(tmp_pack_root):
    (tmp_pack_root / "fingerprint.md").write_text("## Voice fingerprint\nrhythm facts", encoding="utf-8")
    (tmp_pack_root / "exemplars.md").write_text("## The author's actual writing\n> excerpt", encoding="utf-8")
    prompt = compose_prompt(tmp_pack_root, format=None, samples=None, draft=None)
    assert "Voice fingerprint" in prompt
    assert "The author's actual writing" in prompt


def test_distill_prompt_extracts_structured_traits():
    p = _build_prompt(["sample text"])
    for trait in ("opens pieces", "transition", "opinion", "anecdote", "humor"):
        assert trait in p
```

(Adapt fixture names to the existing test files' conventions; `await_materialize` stands for however the existing materialize tests drive the async fn — reuse their helper.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && uv run pytest tests/ -k "fingerprint or exemplar or distill" -q`
Expected: FAIL

- [ ] **Step 3: Implement**

1) `voice/fingerprint.py` — append:

```python
def render_fingerprint_md(sample_texts: list[str]) -> str:
    """Render compute_stats() as prompt-ready guidance. Deterministic."""
    s = compute_stats(sample_texts)
    lengths = s["rhythm"]
    short = sum(1 for n in lengths if n < 10)
    longn = sum(1 for n in lengths if n > 25)
    mix = (
        f"about {round(100 * short / len(lengths))}% of sentences run under 10 words "
        f"and {round(100 * longn / len(lengths))}% over 25"
        if lengths else "not enough sample text to measure rhythm"
    )
    phrases = "".join(f'\n- "{p}"' for p in s["signature_phrases"]) or "\n- (none found)"
    words = ", ".join(s["top_words"]) or "(none)"
    return (
        "## Voice fingerprint (measured from the author's samples)\n\n"
        f"- Sentence rhythm: average {s['avg_sentence_len']} words; {mix}. "
        "Match this distribution — do not flatten to uniform mid-length sentences.\n"
        f"- Signature phrases the author actually uses (reach for these when natural, "
        f"never force them):{phrases}\n"
        f"- Characteristic vocabulary: {words}.\n"
    )


def select_exemplars(sample_texts: list[str], k: int = 3, max_chars: int = 300) -> list[str]:
    """Short verbatim excerpts from distinct samples — the opening run of each
    of the k longest samples, cut at a sentence boundary under max_chars."""
    ranked = sorted((t.strip() for t in sample_texts if t and t.strip()),
                    key=len, reverse=True)[:k]
    out: list[str] = []
    for t in ranked:
        cut = t[:max_chars]
        # end at the last sentence boundary inside the window
        m = list(re.finditer(r"[.!?]", cut))
        out.append(cut[: m[-1].end()] if m else cut)
    return out
```

2) `voice/pack.py` — in `materialize`, after the style-guide write:

```python
    # --- fingerprint.md + exemplars.md (voice texture for the composer) ---
    from blogforge.voice.fingerprint import render_fingerprint_md, select_exemplars

    texts = [sample_texts[sid] for sid in sample_texts]
    if texts:
        (pack_dir / "fingerprint.md").write_text(render_fingerprint_md(texts), encoding="utf-8")
        excerpts = select_exemplars(texts)
        if excerpts:
            body = "\n\n".join(f"> {e}" for e in excerpts)
            (pack_dir / "exemplars.md").write_text(
                "## The author's actual writing — match this texture\n\n" + body + "\n",
                encoding="utf-8",
            )
```

3) `voice/compose.py` — in the prompt assembly (where `style-guide.md` is read, around the `parts.append(_read_cached(pack_root / "style-guide.md"))` line), add after it:

```python
    for extra in ("fingerprint.md", "exemplars.md"):
        p = pack_root / extra
        if p.is_file():
            parts.append(_read_cached(p))
```

4) `voice/distill.py` — replace the prompt body string with the v2 version:

```python
    return (
        "Analyze the writing samples below and produce a concise markdown style guide "
        "that captures how this author writes. Cover, each with concrete do's & don'ts "
        "an imitator can follow:\n"
        "- Tone and register\n"
        "- Sentence rhythm and length (short/long mix, fragments)\n"
        "- How the author opens pieces (question? scene? claim? story?)\n"
        "- Transition habits between ideas and sections\n"
        "- Opinion strength — hedged or declarative, and when\n"
        "- Anecdote and aside frequency — how often the author steps out of the argument\n"
        "- Humor style, if any (dry, self-deprecating, none)\n"
        "- Vocabulary tendencies and formatting habits\n"
        "Write it as guidance an AI could follow to imitate the voice. Output ONLY the "
        "markdown style guide.\n\n"
        f"SAMPLES:\n\n{body}"
    )
```

- [ ] **Step 4: Run**

Run: `cd packages/api && uv run pytest tests/ -k "fingerprint or exemplar or distill or compose or pack" -q`
Expected: PASS (note `voice/validate.py` only requires stylepack.yaml + style-guide.md — the two new files are optional, so no validation change needed)

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/voice/fingerprint.py packages/api/blogforge/voice/pack.py packages/api/blogforge/voice/compose.py packages/api/blogforge/voice/distill.py packages/api/tests/
git commit -m "feat(voice): fingerprint + verbatim exemplars feed compose; distill v2 traits

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Full gates, live verify, release

**Files:**
- Modify: `CHANGELOG.md`
- Modify (via script): `packages/web/package.json`, `packages/api/blogforge/__init__.py`

- [ ] **Step 1: Full test gates**

Run: `cd packages/web && npx tsc --noEmit && npm test` then `cd packages/api && uv run pytest -q`
Expected: all pass (the one pre-existing S3-dependent linkedin test failure is known-unrelated).

- [ ] **Step 2: Live verify (build + Chrome walkthrough)**

Run `bash scripts/serve-local.sh` as a background process and wait for `curl -sf http://127.0.0.1:7880/api/health`. Then with Chrome (existing profile is on the drafted "Running Agents…" draft):

1. Hard-reload (`cmd+shift+r`) — stale-bundle trap.
2. Open Humanize → click **AI fix** on any finding → modal must appear BEFORE any content change → verify word-level highlights both panes → **Cancel** → draft unchanged → AI fix again → **Apply** → card flips accepted, content updated, no amber phase.
3. Test **Edit rewrite** path once: edit a word, Apply, verify edited text landed.
4. Open GEO (Re-analyze for fresh 20-lever report) → verify new levers render with labels, "up to N pts" on headers, "GEO: …" impact lines on cards.
5. On a draft WITH attached references: verify a citations finding names the attached source and its AI fix splices the link (modal shows the inserted markdown link).
6. Proofread rail: one AI fix through the modal.
7. Paste a staccato run ("Isolation and security. Cost and control. As well as speed and scale.") into a section, run Proofread → `staccato_pairs` finding appears.
8. Regenerate the voice profile (Your Voice → re-distill or edit a sample to invalidate the pack cache) → confirm `fingerprint.md`/`exemplars.md` exist in the new pack dir (`ls ~/.blogforge/packcache/*/` — find the actual cache root via `voice/pack.py::_cache_root`).

- [ ] **Step 3: CHANGELOG + version bump**

Add to `CHANGELOG.md` under a new `## [0.3.0]` heading (move items out of Unreleased): fix-preview modal, staccato tell, GEO impact lines + 8 new levers, source-aware citations, voice fingerprint/exemplars/distill v2. Then:

```bash
scripts/version.sh minor
```

Expected output: `0.2.0 → 0.3.0`, both files updated; `scripts/version.sh check` passes.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md packages/web/package.json packages/api/blogforge/__init__.py
git commit -m "chore(release): cut v0.3.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hold for the user**

Do NOT push/PR/merge without the user's explicit go-ahead. Report verification results and wait.
