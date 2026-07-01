import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";

/**
 * The article's opening/lede — the prose that sits ABOVE the first section
 * heading (an imported post's opening, or a generated draft's hook). It's stored
 * on the draft as `outline.opening_hook`, round-trips above the sections on
 * export, and renders first in the reading preview. Click to edit; saves on blur.
 */
export function OpeningCard({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  // Keep local text in sync when the draft reloads with a different opening.
  useEffect(() => setText(value), [value]);

  const html = useMemo(() => (value.trim() ? (marked.parse(value) as string) : ""), [value]);

  function commit(): void {
    setEditing(false);
    if (text !== value) onSave(text);
  }

  return (
    <section className="mb-6 rounded-nb border border-rule bg-surface/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
          Opening
        </span>
        <span className="text-xs text-muted">· the lede above your first section</span>
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          placeholder="The opening paragraph readers see first…"
          // biome-ignore lint/a11y/noAutofocus: focus the field the writer just clicked
          autoFocus
          className="nb-input w-full min-h-[8rem] resize-y text-sm"
          aria-label="Opening"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block w-full text-left"
          title="Click to edit the opening"
        >
          {html ? (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: author's draft markdown rendered with marked (same path as the reading preview)
            <div className="prose-body" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="text-sm text-muted-2">Add an opening…</span>
          )}
        </button>
      )}
    </section>
  );
}
