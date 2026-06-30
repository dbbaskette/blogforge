import { marked } from "marked";
import { useMemo } from "react";

import { type Draft, heroImageUrl } from "../../api/drafts";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";

interface ReadingPreviewProps {
  draft: Draft;
  onClose: () => void;
}

const WORDS_PER_MINUTE = 200;

/**
 * Publish-ready reading preview — a full-screen, typeset rendering of the
 * finished post the way a reader would see it on a blog: hero image, serif
 * title, reading-time byline, and the sections concatenated into one flowing
 * article. Read-only; the editor lives elsewhere.
 */
export function ReadingPreview({ draft, onClose }: ReadingPreviewProps): JSX.Element {
  const overlayRef = useDialogA11y(true, onClose);

  // Only sections with real prose make it into the published view.
  const sections = useMemo(
    () => draft.sections.filter((s) => s.content_md.trim().length > 0),
    [draft.sections],
  );

  const totalWords = useMemo(
    () => sections.reduce((acc, s) => acc + s.word_count, 0),
    [sections],
  );
  const readMinutes = Math.max(1, Math.ceil(totalWords / WORDS_PER_MINUTE));

  // Each section rendered once to HTML; memoized so re-renders don't re-parse.
  const bodyHtml = useMemo(
    () =>
      sections.map((s) => ({
        id: s.id,
        html: marked.parse(s.content_md) as string,
      })),
    [sections],
  );

  const title = draft.title.trim() || "Untitled draft";

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Reading preview"
      className="fixed inset-0 z-50 overflow-y-auto bg-canvas animate-fade-in"
    >
      {/* Floating close affordance — stays put while the article scrolls. */}
      <div className="sticky top-0 z-10 flex justify-end px-4 py-3 pointer-events-none">
        <button
          type="button"
          onClick={onClose}
          className="nb-btn nb-btn-sm shadow-nb-pop pointer-events-auto"
          aria-label="Close reading preview"
        >
          <Icon name="x" size={14} title="" />
          Close preview
        </button>
      </div>

      <article className="mx-auto w-full max-w-[700px] px-5 pb-28 -mt-8">
        {draft.hero_image_key && (
          <figure className="mb-10 overflow-hidden rounded-nb border border-rule shadow-nb">
            <img
              src={heroImageUrl(draft.id, draft.hero_image_key)}
              alt=""
              className="block aspect-[16/9] w-full object-cover"
            />
          </figure>
        )}

        <header className="mb-10 text-center">
          <h1 className="font-serif text-4xl md:text-5xl font-medium leading-[1.12] tracking-tight text-ink text-balance">
            {title}
          </h1>
          <p className="mt-5 flex items-center justify-center gap-2 text-sm text-muted">
            <span>{readMinutes} min read</span>
            <span aria-hidden className="text-muted-2">
              ·
            </span>
            <span>{totalWords.toLocaleString()} words</span>
          </p>
          <hr className="mx-auto mt-8 h-px w-16 border-0 bg-rule-2" />
        </header>

        {bodyHtml.length > 0 ? (
          <div className="prose-body">
            {bodyHtml.map((s) => (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, server-authored draft markdown rendered with marked (same path as the editor)
              <section key={s.id} dangerouslySetInnerHTML={{ __html: s.html }} />
            ))}
          </div>
        ) : (
          <p className="text-center font-serif italic text-muted">
            Nothing to preview yet — write a section first.
          </p>
        )}
      </article>
    </div>
  );
}
