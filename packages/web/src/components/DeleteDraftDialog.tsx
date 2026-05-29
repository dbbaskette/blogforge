import { useState } from "react";
import { Link } from "react-router-dom";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="nb-card w-[460px] max-w-full m-0 p-0 text-ink animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Delete draft"
      >
        <header className="px-7 pt-6 pb-4 border-b border-rule">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose mb-1.5">
            Wastebasket
          </p>
          <h2 className="font-serif text-xl font-medium text-ink tracking-tight">
            Move this draft to the trash?
          </h2>
        </header>

        <div className="px-7 py-5 space-y-3">
          <p className="text-sm text-ink-2 leading-relaxed">
            <em className="font-serif italic text-ink">{draftTitle || draftId}</em> will move to
            Trash. You can restore it any time from the{" "}
            <Link
              to="/trash"
              className="text-cobalt-700 font-medium underline underline-offset-2 hover:text-cobalt-600"
            >
              Trash
            </Link>{" "}
            view.
          </p>
          {error && (
            <p
              className="text-sm px-3 py-2 rounded-nb-sm"
              style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
            >
              {error}
            </p>
          )}
        </div>

        <div className="px-7 pb-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nb-btn">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="nb-btn"
            style={{ background: "#d4546b", borderColor: "#d4546b", color: "#fff" }}
          >
            {submitting ? "Deleting…" : "Move to trash"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
