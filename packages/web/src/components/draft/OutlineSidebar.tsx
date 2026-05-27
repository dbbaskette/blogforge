import type { Draft, Section } from "../../api/drafts";

interface OutlineSidebarProps {
  draft: Draft;
  generatingIds: Set<string>;
  totalWords: number;
  targetWords: number;
}

export function OutlineSidebar({
  draft,
  generatingIds,
  totalWords,
  targetWords,
}: OutlineSidebarProps): JSX.Element {
  const sections =
    draft.sections.length > 0
      ? draft.sections.map((s) => ({
          id: s.id,
          title: s.title,
          status: generatingIds.has(s.id) ? ("generating" as const) : s.status,
          words: s.word_count,
        }))
      : (draft.outline?.sections ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          status: "empty" as Section["status"],
          words: 0,
        }));

  const drafted = draft.sections.filter(
    (s) => s.status === "ready" || s.status === "edited",
  ).length;

  return (
    <aside className="hidden lg:block sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto py-6 pr-2">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">
        In this piece
      </p>

      {sections.length === 0 && (
        <p className="px-3 py-2 text-xs italic text-muted-2">
          Once you generate an outline, sections will appear here.
        </p>
      )}

      <ol className="m-0 p-0 list-none space-y-0.5">
        {sections.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#section-${s.id}`}
              className="group grid grid-cols-[22px_16px_1fr_auto] gap-2 items-center px-3 py-1.5 rounded-nb-sm text-ink-2 hover:bg-white transition-colors no-underline"
            >
              <span className="font-mono text-[11px] text-muted-2 group-hover:text-cobalt-600">
                {String(i + 1).padStart(2, "0")}
              </span>
              <StatusIcon status={s.status} />
              <span className="text-[13px] truncate leading-tight">{s.title}</span>
              <span className="font-mono text-[10px] text-muted-2">
                {s.words > 0 ? `${s.words}w` : "—"}
              </span>
            </a>
          </li>
        ))}
      </ol>

      <div className="mx-3 mt-6 nb-card p-3 text-xs text-muted leading-relaxed space-y-1">
        <Row>
          <span>Drafted</span>
          <strong className="text-ink-2 font-medium font-mono">
            {drafted} / {sections.length}
          </strong>
        </Row>
        <Row>
          <span>Words</span>
          <strong className="text-ink-2 font-medium font-mono">
            {totalWords.toLocaleString()} / {targetWords.toLocaleString()}
          </strong>
        </Row>
        <Row>
          <span>Pack</span>
          <strong className="text-ink-2 font-medium">{draft.idea.pack_slug}</strong>
        </Row>
        <Row>
          <span>Model</span>
          <strong className="text-ink-2 font-medium truncate max-w-[140px]">
            {draft.idea.model}
          </strong>
        </Row>
      </div>
    </aside>
  );
}

function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex justify-between items-center gap-2">{children}</div>;
}

function StatusIcon({ status }: { status: Section["status"] }): JSX.Element {
  const base = "w-3.5 h-3.5 rounded grid place-items-center text-white text-[8px] font-bold";
  switch (status) {
    case "ready":
    case "edited":
      return (
        <span className={`${base} bg-leaf`} aria-label="Ready">
          ✓
        </span>
      );
    case "generating":
      return (
        <span className={`${base} bg-amber animate-pulse`} aria-label="Generating">
          ●
        </span>
      );
    case "failed":
      return (
        <span className={`${base} bg-rose`} aria-label="Failed">
          !
        </span>
      );
    default:
      return (
        <span
          className="w-3.5 h-3.5 rounded border-[1.5px] border-dashed border-muted-2"
          aria-label="Empty"
        />
      );
  }
}
