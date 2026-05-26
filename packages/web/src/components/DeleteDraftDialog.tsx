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
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-full w-full max-w-none items-center justify-center bg-black/60 p-0"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      aria-label="Delete draft"
    >
      <div className="bg-slate-900 border border-red-800 rounded-lg p-6 w-[480px] max-w-[90vw] space-y-4">
        <h2 className="text-lg font-semibold text-red-300">Delete draft</h2>
        <p className="text-slate-300 text-sm">
          This will move <em>{draftTitle || draftId}</em> to the trash. You can recover the files
          manually from <code>~/.pencraft/trash/</code>.
        </p>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50"
          >
            {submitting ? "Deleting…" : "Delete draft"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
