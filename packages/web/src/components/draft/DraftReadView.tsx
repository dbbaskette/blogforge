import { marked } from "marked";
import { useMemo } from "react";

import type { Draft } from "../../api/drafts";

interface DraftReadViewProps {
  draft: Draft;
}

/** Assemble the draft into one continuous, read-optimized document — the
 * same shape the export produces — so the author can read the whole piece
 * end to end instead of section by section. Read-only. */
export function DraftReadView({ draft }: DraftReadViewProps): JSX.Element {
  const html = useMemo(() => {
    const parts: string[] = [];
    if (draft.title) parts.push(`# ${draft.title}`);
    if (draft.outline?.opening_hook?.trim()) parts.push(draft.outline.opening_hook.trim());
    for (const s of draft.sections) {
      parts.push(`## ${s.title}`);
      if (s.content_md.trim()) parts.push(s.content_md.trim());
      else parts.push("_This section hasn't been composed yet._");
    }
    return marked.parse(parts.join("\n\n")) as string;
  }, [draft]);

  const words = draft.sections.reduce((acc, s) => acc + s.word_count, 0);

  return (
    <section className="nb-card p-8 md:p-10 animate-fade-up">
      <div className="flex justify-end mb-4">
        <span className="text-xs font-mono text-muted">{words} words</span>
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendering the author's own draft markdown */}
      <div className="prose-body max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
