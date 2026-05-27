import { useState } from "react";

import { deleteDraft } from "../api/drafts";

interface DeleteDraftDialogProps {
  draftId: string;
  draftTitle: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteDraftDialog({
  draftId,
  draftTitle,
  open,
  onClose,
  onDeleted,
}: DeleteDraftDialogProps): JSX.Element | null {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await deleteDraft(draftId);
      onClose();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="bg-surface border border-rule rounded-sm w-[480px] max-w-[90vw] m-0 p-0 text-cream shadow-2xl shadow-vermilion-900/30"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Delete draft"
      >
        <header className="px-7 pt-6 pb-4 border-b border-rule">
          <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400 mb-2">
            The wastebasket
          </p>
          <h2 className="font-display text-cream-2 text-2xl tracking-tight-2">
            Discard this draft?
          </h2>
        </header>

        <div className="px-7 py-5 space-y-4">
          <p className="font-prose text-cream/80 text-sm leading-relaxed">
            <em className="italic text-cream-2">{draftTitle || draftId}</em> goes to the
            wastebasket. You can recover it manually from{" "}
            <code className="font-mono text-xs text-vermilion-300 bg-ink px-1.5 py-0.5 rounded">
              ~/.pencraft/trash/
            </code>
            .
          </p>
          {error && (
            <p className="text-vermilion-300 text-sm border-l-2 border-vermilion pl-3">{error}</p>
          )}
        </div>

        <div className="px-7 pb-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-press">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={submitting} className="btn-stamp">
            {submitting ? "Discarding…" : "Discard draft"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
