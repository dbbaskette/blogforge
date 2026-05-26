import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { type DraftSummary, deleteDraft, listDrafts } from "../api/drafts";
import { listProviderAvailability } from "../api/providers";
import { NewDraftDialog } from "../components/NewDraftDialog";
import { useGlobalEvents } from "../hooks/useGlobalEvents";

export function DraftsPage(): JSX.Element {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [noKeys, setNoKeys] = useState(false);

  const reload = useCallback(() => {
    listDrafts()
      .then(setDrafts)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => reload(), [reload]);

  useEffect(() => {
    listProviderAvailability()
      .then((map) => setNoKeys(!Object.values(map).some(Boolean)))
      .catch(() => setNoKeys(true));
  }, []);

  const onEvent = useCallback(() => reload(), [reload]);
  useGlobalEvents(onEvent);

  const onDelete = async (id: string): Promise<void> => {
    if (!confirm("Delete this draft?")) return;
    await deleteDraft(id);
    reload();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Drafts</h1>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded"
        >
          + New draft
        </button>
      </div>
      {noKeys && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-200 rounded p-3 text-sm">
          No API keys found in myvoice. Open{" "}
          <a
            href="http://localhost:7878/settings"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            myvoice Settings
          </a>{" "}
          to add one.
        </div>
      )}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      {drafts === null && !error && <p className="text-slate-500 text-sm">Loading…</p>}
      {drafts && drafts.length === 0 && (
        <p className="text-slate-500 text-sm">
          No drafts yet. Click &quot;+ New draft&quot; to start.
        </p>
      )}
      <ul className="divide-y divide-slate-800">
        {drafts?.map((d) => (
          <li key={d.id} className="py-3 flex items-center gap-3">
            <Link to={`/drafts/${d.id}`} className="flex-1 hover:bg-slate-800/50 rounded px-2 py-1">
              <div className="font-medium text-slate-100">{d.title || "(untitled)"}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                [{d.pack_slug}] · {d.stage} · {d.word_count > 0 ? `${d.word_count} words · ` : ""}
                updated {new Date(d.updated_at).toLocaleString()}
              </div>
            </Link>
            <button
              type="button"
              onClick={() => onDelete(d.id)}
              className="text-slate-500 hover:text-red-400 text-sm"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <NewDraftDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
