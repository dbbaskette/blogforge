import { MarkdownEditor } from "./MarkdownEditor";

/**
 * The article's opening/lede — the prose that sits ABOVE the first section
 * heading (an imported post's opening, or a generated draft's hook). It's stored
 * on the draft as `outline.opening_hook`, round-trips above the sections on
 * export, and renders first in the reading preview. Edited with the same rich
 * editor as the section cards (Rich/Raw + inline AI); anchored `#opening` so the
 * outline sidebar's "Intro" entry can scroll to it.
 */
export function OpeningCard({
  value,
  draftId,
  onSave,
}: {
  value: string;
  draftId: string;
  onSave: (next: string) => void | Promise<void>;
}): JSX.Element {
  return (
    <section id="opening" className="mb-6 rounded-nb border border-rule bg-surface/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
          Intro
        </span>
        <span className="text-xs text-muted">· the lede above your first section</span>
      </div>
      <MarkdownEditor
        initialMarkdown={value}
        draftId={draftId}
        onSave={async (md) => {
          await onSave(md);
        }}
      />
    </section>
  );
}
