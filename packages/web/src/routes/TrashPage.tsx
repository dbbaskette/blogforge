import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { type DraftSummary, hardDeleteDraft, listTrashedDrafts, restoreDraft } from "../api/drafts";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";

export function TrashPage(): JSX.Element {
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    listTrashedDrafts()
      .then(setDrafts)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => reload(), [reload]);

  const onRestore = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await restoreDraft(id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onHardDelete = async (id: string): Promise<void> => {
    if (!(await confirm({ title: "Delete this draft forever?", message: "This cannot be undone.", confirmLabel: "Delete forever", danger: true }))) return;
    setBusyId(id);
    setError(null);
    try {
      await hardDeleteDraft(id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Wastebasket
        </p>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
            Trash
          </h1>
          <Link to="/" className="nb-btn nb-btn-ghost nb-btn-sm no-underline">
            ← Your drafts
          </Link>
        </div>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Trashed drafts live here. Restore one to bring it back, or delete it forever.
        </p>
      </header>

      {error && (
        <div
          className="mb-6 rounded-nb p-4 flex items-start gap-3"
          style={{ border: "1px solid #f7c3b6", background: "#fde7e2" }}
        >
          <span className="nb-pill nb-pill-failed">Error</span>
          <p className="text-sm text-rose-ink leading-relaxed">{error}</p>
        </div>
      )}

      {drafts === null && !error && (
        <p className="text-center text-muted text-sm py-16">Loading…</p>
      )}

      {drafts && drafts.length === 0 && (
        <div className="nb-card text-center py-16 px-8">
          <div className="w-12 h-12 rounded-full bg-cobalt-50 grid place-items-center mx-auto mb-5 text-cobalt-600">
            <Icon name="trash" size={22} title="" />
          </div>
          <p className="text-muted text-sm">Trash is empty.</p>
        </div>
      )}

      {drafts && drafts.length > 0 && (
        <div className="space-y-3">
          {drafts.map((d) => (
            <TrashRow
              key={d.id}
              draft={d}
              busy={busyId === d.id}
              onRestore={() => onRestore(d.id)}
              onHardDelete={() => onHardDelete(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrashRow({
  draft,
  busy,
  onRestore,
  onHardDelete,
}: {
  draft: DraftSummary;
  busy: boolean;
  onRestore: () => void;
  onHardDelete: () => void;
}): JSX.Element {
  return (
    <article className="nb-card">
      <div className="flex items-start gap-4 p-5">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-xl font-medium text-ink leading-snug tracking-tight">
            {draft.title || <span className="italic text-muted-2">untitled draft</span>}
          </h3>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="nb-pill nb-pill-empty">{draft.pack_slug}</span>
            <span className="text-xs text-muted-2">Trashed {formatRelative(draft.updated_at)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onRestore} disabled={busy} className="nb-btn nb-btn-sm">
            Restore
          </button>
          <button
            type="button"
            onClick={onHardDelete}
            disabled={busy}
            className="nb-btn nb-btn-sm"
            style={{ background: "#e6492d", borderColor: "#e6492d", color: "#fff" }}
          >
            Delete forever
          </button>
        </div>
      </div>
    </article>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "moments ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
