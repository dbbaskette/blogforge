import { useMemo, useState } from "react";

import { trimContext, reviewDiff } from "../../lib/reviewDiff";
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

  const segs = useMemo(() => trimContext(reviewDiff(before, after)), [before, after]);

  const pane = (side: "original" | "rewrite"): JSX.Element[] => {
    const drop = side === "original" ? "added" : "removed";
    const mark = side === "original" ? "removed" : "added";
    return segs
      .filter((s) => s.kind !== drop)
      .map((s, i) =>
        s.kind === mark ? (
          side === "original" ? (
            <del
              key={`${i}-${s.text.slice(0, 8)}`}
              className="bg-coral-soft text-coral-ink rounded-[3px] px-0.5 line-through"
            >
              {s.text}
            </del>
          ) : (
            <mark
              key={`${i}-${s.text.slice(0, 8)}`}
              className="bg-green-soft text-green-ink rounded-[3px] px-0.5"
            >
              {s.text}
            </mark>
          )
        ) : (
          <span key={`${i}-${s.text.slice(0, 8)}`}>{s.text}</span>
        ),
      )
      .reduce<JSX.Element[]>(
        (acc, el, i) => (i ? [...acc, <span key={`sp${i}`}> </span>, el] : [el]),
        [],
      );
  };

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
              {pane("original")}
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
                {pane("rewrite")}
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
