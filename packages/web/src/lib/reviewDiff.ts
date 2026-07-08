/**
 * Word-level diff for the fix-preview modal. Pure + dependency-free.
 * Tokenizes on whitespace (so reflow is not a change), builds a classic LCS
 * table, and merges the backtrace into runs. O(n*m) — fine for section-sized
 * text (a few hundred words).
 *
 * Distinct from lib/wordDiff.ts (the version-history diff): that one preserves
 * whitespace fidelity for document diffs; this one is whitespace-insensitive
 * (reflow is not a change) and trims context, which is what the fix-preview
 * compare needs.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffSeg {
  kind: DiffKind;
  text: string;
}

const tokens = (s: string): string[] => s.split(/\s+/).filter(Boolean);

export function reviewDiff(before: string, after: string): DiffSeg[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
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
  // A diff with no changes needs no trimming — and must not grow "…" markers
  // that would imply an adjacent change.
  if (segs.length === 1 && segs[0]?.kind === "same") return segs;
  return segs.map((seg, idx) => {
    if (seg.kind !== "same") return seg;
    const words = seg.text.split(" ");
    const isFirst = idx === 0;
    const isLast = idx === segs.length - 1;
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
