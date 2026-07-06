import type { TrackedChangeKind } from "../draft/trackedChangeDecoration";

interface HighlightedTextProps {
  text: string;
  /** The run to highlight. No highlight when null/absent. */
  mark?: string | null;
  kind?: TrackedChangeKind;
}

/** Strip wrapping quotes and leading/trailing ellipses a flagged target often
 *  carries (GEO snippets frequently arrive quoted or truncated with "…"). */
function normalizeMark(mark: string): string {
  return mark
    .trim()
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .replace(/^(?:…|\.\.\.)+/, "")
    .replace(/(?:…|\.\.\.)+$/, "")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whitespace-tolerant, case-insensitive search: run words may be separated by
 *  different whitespace in the source markdown than in the flagged snippet. */
function looseFind(text: string, needle: string): { start: number; end: number } | null {
  const exact = text.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };
  try {
    const re = new RegExp(escapeRegExp(needle).replace(/\s+/g, "\\s+"), "i");
    const m = re.exec(text);
    if (m) return { start: m.index, end: m.index + m[0].length };
  } catch {
    /* malformed pattern — fall through */
  }
  return null;
}

/** Locate the run to highlight, tolerating whitespace/quote/ellipsis drift and
 *  falling back to a leading prefix when the full snippet doesn't match. */
export function findHighlight(text: string, mark: string): { start: number; end: number } | null {
  const needle = normalizeMark(mark);
  if (needle.length < 2) return null;
  // Full snippet first, then progressively shorter leading chunks (for
  // truncated or slightly-divergent targets), longest first so we highlight
  // as much as still matches.
  const candidates = [needle];
  for (const len of [80, 60, 40, 24]) {
    if (needle.length > len) candidates.push(needle.slice(0, len).trim());
  }
  for (const c of candidates) {
    if (c.length < 12 && c !== needle) continue;
    const hit = looseFind(text, c);
    if (hit) return hit;
  }
  return null;
}

/**
 * Render `text`, wrapping the located `mark` run in a highlight span
 * (`tracked-change--{kind}` — amber for under-review, yellow for locate). The
 * Optimize read-pane is plain text (not a TipTap editor), so it highlights by
 * (tolerant) string match rather than ProseMirror decorations.
 */
export function HighlightedText({
  text,
  mark,
  kind = "locate",
}: HighlightedTextProps): JSX.Element {
  const hit = mark ? findHighlight(text, mark) : null;
  if (!hit) return <>{text}</>;
  return (
    <>
      {text.slice(0, hit.start)}
      <mark className={`tracked-change tracked-change--${kind}`}>
        {text.slice(hit.start, hit.end)}
      </mark>
      {text.slice(hit.end)}
    </>
  );
}
