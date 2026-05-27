import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { type DraftSummary, deleteDraft, listDrafts } from "../api/drafts";
import { listProviderAvailability } from "../api/providers";
import { NewDraftDialog } from "../components/NewDraftDialog";
import { useGlobalEvents } from "../hooks/useGlobalEvents";

const STAGE_LABELS: Record<DraftSummary["stage"], { label: string; chip: string }> = {
  idea: { label: "Seed", chip: "chip" },
  outline: { label: "Outline", chip: "chip chip-teal" },
  sections: { label: "Drafting", chip: "chip chip-gold" },
};

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
    if (!confirm("Move this draft to the wastebasket?")) return;
    await deleteDraft(id);
    reload();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <Hero count={drafts?.length ?? 0} onNew={() => setNewOpen(true)} />

      {noKeys && <KeysBanner />}
      {error && <ErrorBanner message={error} />}

      <section className="mt-8">
        <SectionMast label="The desk" subline="drafts in progress" />

        {drafts === null && !error && (
          <p className="font-mono text-xs uppercase tracking-wide-3 text-muted py-12 text-center">
            …
          </p>
        )}

        {drafts && drafts.length === 0 && <EmptyState onNew={() => setNewOpen(true)} />}

        {drafts && drafts.length > 0 && (
          <ol className="mt-2">
            {drafts.map((d, i) => (
              <DraftRow key={d.id} draft={d} index={i + 1} onDelete={() => onDelete(d.id)} />
            ))}
            <li className="rule" />
          </ol>
        )}
      </section>

      <NewDraftDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Hero

function Hero({ count, onNew }: { count: number; onNew: () => void }): JSX.Element {
  return (
    <section className="grid grid-cols-12 gap-8 items-end animate-fade-up">
      <div className="col-span-12 md:col-span-8">
        <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400 mb-3">
          Issue {String(count).padStart(2, "0")} ·{" "}
          {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
        <h1 className="font-display text-cream-2 text-[clamp(2.75rem,6vw,4.5rem)] leading-[0.95] tracking-tight-2">
          A workshop for{" "}
          <span
            className="italic text-vermilion-400"
            style={{ fontVariationSettings: "'SOFT' 100, 'WONK' 1" }}
          >
            long-form
          </span>{" "}
          writing in your voice.
        </h1>
        <p className="font-prose text-cream/70 text-lg mt-6 max-w-xl leading-relaxed">
          Sketch an idea, shape its outline, then let the pack do the writing in your tongue. Every
          piece begins on this desk.
        </p>
      </div>
      <div className="col-span-12 md:col-span-4 flex md:justify-end">
        <button type="button" onClick={onNew} className="btn-stamp">
          <span aria-hidden className="text-base leading-none">
            ✺
          </span>
          Start a new piece
        </button>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Section masthead — "The desk" + subline

function SectionMast({ label, subline }: { label: string; subline: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="font-display text-cream-2 text-2xl tracking-tight-2">{label}</h2>
      <span className="font-mono text-[10px] uppercase tracking-wide-3 text-muted">{subline}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Single draft row — like a TOC entry

function DraftRow({
  draft,
  index,
  onDelete,
}: {
  draft: DraftSummary;
  index: number;
  onDelete: () => void;
}): JSX.Element {
  const stage = STAGE_LABELS[draft.stage];
  const updated = formatRelative(draft.updated_at);

  return (
    <li className="group border-t border-rule first:border-t-0">
      <div className="grid grid-cols-[3.5rem_1fr_auto] gap-6 items-start py-6">
        {/* Big numeral */}
        <span className="font-display-tight text-muted-2 text-3xl leading-none pt-1 group-hover:text-vermilion-400 transition-colors duration-300 font-mono-num">
          {String(index).padStart(2, "0")}
        </span>

        {/* Title + meta */}
        <Link to={`/drafts/${draft.id}`} className="block min-w-0">
          <h3 className="font-display text-cream-2 text-[1.65rem] leading-tight tracking-tight-2 ink-underline inline-block">
            {draft.title || <span className="italic text-muted">untitled draft</span>}
          </h3>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className={stage.chip}>{stage.label}</span>
            <span className="chip chip-muted">{draft.pack_slug}</span>
            {draft.word_count > 0 && (
              <span className="font-mono text-xs text-muted">
                {draft.word_count.toLocaleString()} words
              </span>
            )}
            <span className="font-mono text-xs text-muted-2">— {updated}</span>
          </div>
        </Link>

        {/* Delete action — visible on hover */}
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${draft.title || "untitled draft"}`}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-200 font-mono text-[10px] uppercase tracking-wide-3 text-muted hover:text-vermilion-400 self-start pt-2"
        >
          discard
        </button>
      </div>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────
// Empty state — characterful, not boring

function EmptyState({ onNew }: { onNew: () => void }): JSX.Element {
  return (
    <div className="mt-8 border border-rule rounded-sm py-16 px-8 text-center relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent 0 12px, #E04E3F 12px 13px)",
        }}
      />
      <div className="relative">
        <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400">
          a blank desk
        </p>
        <h3 className="font-display text-cream-2 text-3xl mt-3 tracking-tight-2">
          Nothing here yet.
        </h3>
        <p className="font-prose text-cream/60 mt-3 max-w-md mx-auto">
          Every piece you write starts with a single seed — a topic, a question, a hook. Plant one.
        </p>
        <button type="button" onClick={onNew} className="btn-stamp mt-7">
          Plant a seed
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Top-of-page banners

function KeysBanner(): JSX.Element {
  return (
    <div className="mt-6 border-l-2 border-gold pl-4 py-3 bg-gold/[0.04]">
      <p className="font-mono text-[10px] uppercase tracking-wide-3 text-gold">notice</p>
      <p className="text-sm text-cream/80 mt-1">
        No API keys found in myvoice. Add one in{" "}
        <a
          href="http://localhost:7878/settings"
          target="_blank"
          rel="noreferrer"
          className="text-gold-400 underline underline-offset-4 hover:no-underline"
        >
          myvoice Settings
        </a>{" "}
        before drafting.
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="mt-6 border-l-2 border-vermilion pl-4 py-3 bg-vermilion-900/30">
      <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400">error</p>
      <p className="text-sm text-cream/80 mt-1">{message}</p>
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
