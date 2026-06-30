/**
 * Dependency-free word-level diff.
 *
 * Splits both inputs into whitespace-delimited tokens, computes the longest
 * common subsequence (LCS) of those tokens, then walks the LCS backtrace to
 * emit contiguous runs of unchanged / added / deleted words.
 *
 * Tuned for paragraph-sized prose (the section content we diff in the version
 * history). The LCS table is O(n·m) in tokens; for the short bodies we diff
 * here that is comfortably fast.
 */

export interface DiffPart {
  type: "same" | "add" | "del";
  text: string;
}

/**
 * Split into tokens, keeping the trailing whitespace attached to each word so
 * that when we re-join the runs the original spacing is preserved.
 */
function tokenize(input: string): string[] {
  // Match a run of non-whitespace followed by its trailing whitespace (if any).
  const matches = input.match(/\S+\s*/g);
  return matches ?? [];
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];

  // LCS length table: lcs[i][j] = LCS length of a[i:] and b[j:].
  // (rows n+1, cols m+1, all initialised to 0)
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];

  // Push a token onto the current run, merging with the previous part when the
  // type matches so we emit contiguous runs rather than one part per word.
  const push = (type: DiffPart["type"], text: string): void => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      parts.push({ type, text });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", b[j]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) {
    push("del", a[i]);
    i++;
  }
  while (j < m) {
    push("add", b[j]);
    j++;
  }

  return parts;
}
