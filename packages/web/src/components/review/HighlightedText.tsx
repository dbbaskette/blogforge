import type { TrackedChangeKind } from "../draft/trackedChangeDecoration";

interface HighlightedTextProps {
  text: string;
  /** The run to highlight (first occurrence). No highlight when null/absent. */
  mark?: string | null;
  kind?: TrackedChangeKind;
}

/**
 * Render `text`, wrapping the first occurrence of `mark` in a highlight span
 * (`tracked-change--{kind}` — amber for under-review, yellow for locate). Used
 * by the Optimize read-pane, which is plain text rather than a TipTap editor,
 * so it highlights by string match instead of ProseMirror decorations.
 */
export function HighlightedText({
  text,
  mark,
  kind = "locate",
}: HighlightedTextProps): JSX.Element {
  const trimmed = mark?.trim();
  const idx = trimmed ? text.indexOf(trimmed) : -1;
  if (!trimmed || idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={`tracked-change tracked-change--${kind}`}>
        {text.slice(idx, idx + trimmed.length)}
      </mark>
      {text.slice(idx + trimmed.length)}
    </>
  );
}
