import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  type DraftStage,
  type DraftSummary,
  deleteDraft,
  expandSections,
  listDrafts,
  setDraftTags,
} from "../api/drafts";
import { listProviderAvailability } from "../api/providers";
import { getVoiceProfile } from "../api/voice";
import { OnboardingChecklist, type OnboardingStep } from "../components/OnboardingChecklist";
import { DraftHealthBadges } from "../components/draft/DraftHealthBadges";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { useGlobalEvents } from "../hooks/useGlobalEvents";

const ONBOARDING_DISMISSED_KEY = "bf.onboarding.dismissed";

const STAGE_LABEL: Record<DraftSummary["stage"], { label: string; pillClass: string }> = {
  research: { label: "Researching", pillClass: "nb-pill nb-pill-empty" },
  outline: { label: "Outline", pillClass: "nb-pill nb-pill-edited" },
  sections: { label: "Drafting", pillClass: "nb-pill nb-pill-gen" },
};

const STAGE_FILTERS: { value: DraftStage | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "research", label: "Researching" },
  { value: "outline", label: "Outline" },
  { value: "sections", label: "Drafting" },
];

type SortKey = "updated" | "title" | "words";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title (A–Z)" },
  { value: "words", label: "Most words" },
];

export function DraftsPage(): JSX.Element {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noKeys, setNoKeys] = useState(false);

  // Onboarding checklist state.
  const [hasProvider, setHasProvider] = useState(false);
  const [hasVoice, setHasVoice] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1",
  );

  // Filters (client-side over the loaded list).
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<DraftStage | "all">("all");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("updated");

  const reload = useCallback(() => {
    listDrafts()
      .then(setDrafts)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => reload(), [reload]);

  useEffect(() => {
    listProviderAvailability()
      .then((map) => {
        const available = Object.values(map).some(Boolean);
        setNoKeys(!available);
        setHasProvider(available);
      })
      .catch(() => setNoKeys(true));
  }, []);

  useEffect(() => {
    getVoiceProfile()
      .then((p) => setHasVoice(p.distilled_style_md.trim().length > 0 || p.samples.length > 0))
      .catch(() => setHasVoice(false));
  }, []);

  const onEvent = useCallback(() => reload(), [reload]);
  useGlobalEvents(onEvent);

  const onDelete = async (id: string): Promise<void> => {
    if (
      !(await confirm({
        title: "Move this draft to the trash?",
        message: "You can restore it any time from Trash.",
        confirmLabel: "Move to trash",
        danger: true,
      }))
    )
      return;
    await deleteDraft(id);
    reload();
  };

  const onTagsChange = useCallback(async (id: string, tags: string[]): Promise<void> => {
    const updated = await setDraftTags(id, tags);
    setDrafts((cur) =>
      cur ? cur.map((d) => (d.id === id ? { ...d, tags: updated.tags } : d)) : cur,
    );
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of drafts ?? []) for (const t of d.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [drafts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (drafts ?? []).filter((d) => {
      if (stageFilter !== "all" && d.stage !== stageFilter) return false;
      if (activeTags.size > 0 && !d.tags.some((t) => activeTags.has(t))) return false;
      if (q && !`${d.title} ${d.pack_slug}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [drafts, query, stageFilter, activeTags]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sortKey) {
      case "title":
        copy.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "words":
        copy.sort((a, b) => b.word_count - a.word_count);
        break;
      default:
        copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        break;
    }
    return copy;
  }, [filtered, sortKey]);

  const toggleTag = (tag: string): void =>
    setActiveTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const hasFilters = query.trim() !== "" || stageFilter !== "all" || activeTags.size > 0;

  const onboardingSteps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: "provider",
        label: "Add a provider key or use Tanzu",
        to: "/settings",
        done: hasProvider,
      },
      { key: "voice", label: "Set up Your Voice", to: "/voice", done: hasVoice },
      {
        key: "draft",
        label: "Write your first piece",
        to: "/compose",
        done: (drafts?.length ?? 0) > 0,
      },
    ],
    [hasProvider, hasVoice, drafts],
  );

  const showOnboarding = !onboardingDismissed && onboardingSteps.some((s) => !s.done);

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    setOnboardingDismissed(true);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <Hero onNew={() => navigate("/compose")} />

      {showOnboarding && (
        <OnboardingChecklist steps={onboardingSteps} onDismiss={dismissOnboarding} />
      )}
      {noKeys && <KeysBanner />}
      {error && <ErrorBanner message={error} />}

      <section className="mt-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">Your drafts</h2>
          <div className="flex items-baseline gap-3">
            <span className="text-xs text-muted">
              {hasFilters && drafts
                ? `${filtered.length} of ${drafts.length}`
                : (drafts?.length ?? 0)}{" "}
              {/* The noun agrees with the total ("0 of 1 piece"), not the filtered count. */}
              {(drafts?.length ?? 0) === 1 ? "piece" : "pieces"}
            </span>
            <Link
              to="/trash"
              className="text-xs text-muted hover:text-cobalt-600 underline underline-offset-2 transition-colors"
            >
              Trash
            </Link>
          </div>
        </div>

        {drafts && drafts.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title or pack…"
                aria-label="Search drafts"
                className="nb-input flex-1 min-w-0"
              />
              <div className="inline-flex rounded-nb-sm border border-rule overflow-hidden self-start">
                {STAGE_FILTERS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setStageFilter(s.value)}
                    aria-pressed={stageFilter === s.value}
                    className={`px-3 py-1.5 text-sm font-medium border-l border-rule first:border-l-0 transition-colors ${
                      stageFilter === s.value
                        ? "bg-cobalt-50 text-cobalt-700"
                        : "bg-card text-muted hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {/* width:auto overrides .nb-select's width:100%, which otherwise
                  claims the whole flex row and crushes the search input. */}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                aria-label="Sort drafts"
                className="nb-select self-start"
                style={{ width: "auto" }}
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted mr-1">Tags:</span>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={activeTags.has(tag)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      activeTags.has(tag)
                        ? "border-cobalt-300 bg-cobalt-50 text-cobalt-700"
                        : "border-rule bg-card text-muted hover:text-ink"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
                {activeTags.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTags(new Set())}
                    className="text-xs text-muted hover:text-ink underline underline-offset-2 ml-1"
                  >
                    clear
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {drafts === null && !error && (
          <p className="text-center text-muted text-sm py-16">Loading…</p>
        )}

        {drafts && drafts.length === 0 && <EmptyState onNew={() => navigate("/compose")} />}

        {drafts && drafts.length > 0 && filtered.length === 0 && (
          <div className="nb-card p-8 text-center">
            <p className="italic text-muted mb-4">No drafts match your filters.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStageFilter("all");
                setActiveTags(new Set());
              }}
              className="nb-btn nb-btn-sm"
            >
              Clear filters
            </button>
          </div>
        )}

        {drafts && sorted.length > 0 && (
          <div className="space-y-3">
            {sorted.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                onDelete={() => onDelete(d.id)}
                onTagsChange={(tags) => onTagsChange(d.id, tags)}
              />
            ))}
          </div>
        )}
      </section>
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
            writing in{" "}
            <span className="relative inline-block italic">
              your voice.
              <svg className="ink-underline" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                <path d="M1,5.5 C 22,7.5 38,2.5 58,4 C 76,5.3 90,3.2 99,4.6" pathLength="120" />
              </svg>
            </span>
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
  onTagsChange,
}: {
  draft: DraftSummary;
  onDelete: () => void;
  onTagsChange: (tags: string[]) => Promise<void>;
}): JSX.Element {
  const stage = STAGE_LABEL[draft.stage];
  const updated = formatRelative(draft.updated_at);
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  // Stage-aware quick action: pick the piece back up without a detour through
  // the editor chrome. Outline-stage cards can kick off the compose directly.
  const quickAction =
    draft.stage === "research"
      ? { label: "Continue research →", run: () => navigate(`/drafts/${draft.id}`) }
      : draft.stage === "outline"
        ? {
            label: composing ? "Starting…" : "Compose sections →",
            run: async () => {
              setComposing(true);
              try {
                await expandSections(draft.id);
              } catch {
                /* the draft page surfaces compose errors */
              } finally {
                navigate(`/drafts/${draft.id}`);
              }
            },
          }
        : null;

  return (
    // `relative` anchors the title's stretched-link overlay: the WHOLE card
    // navigates, while tag/delete/quick-action controls sit above it at z-10.
    <article className="group nb-card nb-card-hover overflow-hidden relative">
      <div className="flex items-stretch">
        {/* Margin gutter — the manuscript signature. Marginalia: word count
            and freshness, ledger-aligned down the list. */}
        <div className="ms-gutter pt-5 pl-4 pr-3">
          <div className="marginalia marginalia-strong">{fmtWords(draft.word_count)}</div>
          <div className="marginalia mt-0.5">{updated.compact}</div>
        </div>

        <div className="flex-1 min-w-0 flex items-start gap-4 p-5">
          <div className="flex-1 min-w-0">
            <Link
              to={`/drafts/${draft.id}`}
              className="block after:absolute after:inset-0 after:content-['']"
            >
              <h3 className="font-serif text-xl font-medium text-ink leading-snug tracking-tight group-hover:text-cobalt-600 transition-colors">
                {draft.title || <span className="italic text-muted-2">untitled draft</span>}
              </h3>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className={stage.pillClass}>
                  <span className="dot" />
                  {stage.label}
                </span>
                <span className="nb-pill nb-pill-empty">{draft.pack_slug}</span>
                <span className="text-xs text-muted-2">{updated.long}</span>
              </div>
              <DraftHealthBadges draftId={draft.id} stage={draft.stage} />
            </Link>
            <div className="relative z-10 flex items-center gap-3 flex-wrap">
              <TagEditor tags={draft.tags} onChange={onTagsChange} />
              {quickAction && (
                <button
                  type="button"
                  onClick={() => void quickAction.run()}
                  disabled={composing}
                  className="mt-2 text-xs font-medium text-cobalt-600 hover:text-cobalt-700 disabled:opacity-60"
                >
                  {quickAction.label}
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${draft.title || "untitled draft"}`}
            className="nb-icon-btn relative z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:!text-rose"
            title="Move to trash"
          >
            <Icon name="trash" size={16} title="" />
          </button>
        </div>
      </div>
    </article>
  );
}

/** Marginalia word count: 1804 → "1.8k", 0 → "—". */
function fmtWords(n: number): string {
  if (n <= 0) return "—";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

// ────────────────────────────────────────────────────────────────
// Inline tag editor (chips + add)

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => Promise<void>;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const commit = async (next: string[]): Promise<void> => {
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const t = value.trim();
    setValue("");
    setAdding(false);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      await commit([...tags, t]);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full border border-rule bg-canvas px-2 py-0.5 text-xs text-ink-2"
        >
          {tag}
          <button
            type="button"
            onClick={() => void commit(tags.filter((x) => x !== tag))}
            disabled={busy}
            aria-label={`Remove tag ${tag}`}
            className="text-muted hover:text-rose"
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: focus the inline tag field the moment it opens
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void add()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
            if (e.key === "Escape") {
              setValue("");
              setAdding(false);
            }
          }}
          placeholder="tag…"
          aria-label="New tag"
          className="w-24 bg-canvas border border-rule rounded-full px-2 py-0.5 text-xs focus:outline-none focus:border-cobalt-300"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-full border border-dashed border-rule px-2 py-0.5 text-xs text-muted hover:text-cobalt-600 hover:border-cobalt-300 transition-colors"
        >
          + tag
        </button>
      )}
    </div>
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

function KeysBanner(): JSX.Element {
  return (
    <div
      className="mt-6 rounded-nb p-4 flex items-start gap-3"
      style={{ border: "1px solid #f3d89b", background: "#fbf1de" }}
    >
      <span className="nb-pill nb-pill-gen">Heads up</span>
      <p className="text-sm text-ink-2 leading-relaxed">
        No writing model is available yet. Add your own provider API key in{" "}
        <Link
          to="/settings"
          className="text-cobalt-600 font-medium underline underline-offset-2 hover:text-cobalt-700"
        >
          Settings → Provider API keys
        </Link>{" "}
        to start drafting.
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      className="mt-6 rounded-nb p-4 flex items-start gap-3"
      style={{ border: "1px solid #f7c3b6", background: "#fde7e2" }}
    >
      <span className="nb-pill nb-pill-failed">Error</span>
      <p className="text-sm text-rose-ink leading-relaxed">{message}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Helpers

/** Relative freshness in two registers: `long` for prose ("5h ago") and
 * `compact` for the margin gutter ("5h"). */
function formatRelative(iso: string): { long: string; compact: string } {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return { long: "moments ago", compact: "now" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { long: `${minutes}m ago`, compact: `${minutes}m` };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { long: `${hours}h ago`, compact: `${hours}h` };
  const days = Math.floor(hours / 24);
  if (days < 30) return { long: `${days}d ago`, compact: `${days}d` };
  const date = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { long: date, compact: date };
}
