import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { type DraftSummary, deleteDraft, listDrafts } from "../api/drafts";
import { listProviderAvailability } from "../api/providers";
import { NewDraftDialog } from "../components/NewDraftDialog";
import { Icon } from "../components/ui/Icon";
import { useGlobalEvents } from "../hooks/useGlobalEvents";
import { useMe } from "../hooks/useMe";

const STAGE_LABEL: Record<DraftSummary["stage"], { label: string; pillClass: string }> = {
  research: { label: "Researching", pillClass: "nb-pill nb-pill-empty" },
  outline: { label: "Outline", pillClass: "nb-pill nb-pill-edited" },
  sections: { label: "Drafting", pillClass: "nb-pill nb-pill-gen" },
};

export function DraftsPage(): JSX.Element {
  const { user } = useMe();
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
    if (!confirm("Move this draft to the trash?")) return;
    await deleteDraft(id);
    reload();
  };

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <Hero onNew={() => setNewOpen(true)} />

      {noKeys && <KeysBanner isAdmin={user?.role === "admin"} />}
      {error && <ErrorBanner message={error} />}

      <section className="mt-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">Your drafts</h2>
          <div className="flex items-baseline gap-3">
            <span className="text-xs text-muted">
              {drafts?.length ?? 0} {drafts?.length === 1 ? "piece" : "pieces"}
            </span>
            <Link
              to="/trash"
              className="text-xs text-muted hover:text-cobalt-600 underline underline-offset-2 transition-colors"
            >
              Trash
            </Link>
          </div>
        </div>

        {drafts === null && !error && (
          <p className="text-center text-muted text-sm py-16">Loading…</p>
        )}

        {drafts && drafts.length === 0 && <EmptyState onNew={() => setNewOpen(true)} />}

        {drafts && drafts.length > 0 && (
          <div className="space-y-3">
            {drafts.map((d) => (
              <DraftRow key={d.id} draft={d} onDelete={() => onDelete(d.id)} />
            ))}
          </div>
        )}
      </section>

      <NewDraftDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Hero

function Hero({ onNew }: { onNew: () => void }): JSX.Element {
  return (
    <section className="mb-2">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
            Workshop
          </p>
          <h1 className="font-serif text-4xl md:text-5xl font-medium text-ink leading-[1.1] tracking-tight">
            A space for long-form
            <br />
            writing in your voice.
          </h1>
          <p className="text-base text-muted mt-3 max-w-xl leading-relaxed">
            Sketch an idea, shape its outline, then let the pack do the writing in your tongue.
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="nb-btn nb-btn-primary self-start md:self-end"
        >
          <span aria-hidden>＋</span>
          New piece
        </button>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Draft row — Notebook card

function DraftRow({
  draft,
  onDelete,
}: {
  draft: DraftSummary;
  onDelete: () => void;
}): JSX.Element {
  const stage = STAGE_LABEL[draft.stage];
  const updated = formatRelative(draft.updated_at);

  return (
    <article className="group nb-card nb-card-hover">
      <div className="flex items-start gap-4 p-5">
        <Link to={`/drafts/${draft.id}`} className="flex-1 min-w-0">
          <h3 className="font-serif text-xl font-medium text-ink leading-snug tracking-tight group-hover:text-cobalt-600 transition-colors">
            {draft.title || <span className="italic text-muted-2">untitled draft</span>}
          </h3>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className={stage.pillClass}>
              <span className="dot" />
              {stage.label}
            </span>
            <span className="nb-pill nb-pill-empty">{draft.pack_slug}</span>
            {draft.word_count > 0 && (
              <span className="text-xs text-muted font-mono">
                {draft.word_count.toLocaleString()} words
              </span>
            )}
            <span className="text-xs text-muted-2">· {updated}</span>
          </div>
        </Link>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${draft.title || "untitled draft"}`}
          className="nb-icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:!text-rose"
          title="Move to trash"
        >
          <Icon name="trash" size={16} title="" />
        </button>
      </div>
    </article>
  );
}

// ────────────────────────────────────────────────────────────────
// Empty state

function EmptyState({ onNew }: { onNew: () => void }): JSX.Element {
  return (
    <div className="nb-card text-center py-16 px-8">
      <div className="w-12 h-12 rounded-full bg-cobalt-50 grid place-items-center mx-auto mb-5 text-cobalt-600">
        <Icon name="file-plus" size={22} title="" />
      </div>
      <h3 className="font-serif text-2xl font-medium text-ink mb-2 tracking-tight">
        Nothing here yet
      </h3>
      <p className="text-muted text-sm max-w-md mx-auto mb-6 leading-relaxed">
        Every piece starts with a topic, a question, a hook. Plant one.
      </p>
      <button type="button" onClick={onNew} className="nb-btn nb-btn-primary">
        <span aria-hidden>＋</span>
        Start a new piece
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Banners

function KeysBanner({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  return (
    <div
      className="mt-6 rounded-nb p-4 flex items-start gap-3"
      style={{ border: "1px solid #f0d5a4", background: "#fdf6e6" }}
    >
      <span className="nb-pill nb-pill-gen">Heads up</span>
      <p className="text-sm text-ink-2 leading-relaxed">
        No API keys configured.{" "}
        {isAdmin ? (
          <>
            Add one in{" "}
            <Link
              to="/admin"
              className="text-cobalt-600 font-medium underline underline-offset-2 hover:text-cobalt-700"
            >
              /admin
            </Link>{" "}
            (API keys section) before drafting.
          </>
        ) : (
          <>Ask an admin to add one before drafting.</>
        )}
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      className="mt-6 rounded-nb p-4 flex items-start gap-3"
      style={{ border: "1px solid #f7c7cf", background: "#fde9ec" }}
    >
      <span className="nb-pill nb-pill-failed">Error</span>
      <p className="text-sm text-rose-ink leading-relaxed">{message}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Helpers

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
