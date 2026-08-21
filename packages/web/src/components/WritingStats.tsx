import { useMemo } from "react";

import type { DraftSummary } from "../api/drafts";

const WEEKS_SHOWN = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

interface WritingStats {
  /** Drafts created during the current calendar month. */
  piecesThisMonth: number;
  /** Summed word count of drafts touched this calendar month. */
  wordsThisMonth: number;
  /** Consecutive 7-day buckets (ending with the current one) containing ≥1 touched draft. */
  weekStreak: number;
  /** Word volume per rolling 7-day bucket, oldest → current, for the sparkline. */
  weeklyWords: number[];
}

/**
 * Writing activity derived from the drafts list — no extra API call.
 * "Touched" means updated_at; word counts are each draft's CURRENT size,
 * so the sparkline reads as writing volume, not a precise daily ledger.
 */
function computeStats(drafts: DraftSummary[], now = new Date()): WritingStats {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  // Buckets are aligned to end at "now": bucket i covers
  // [now - (i+1)*7d, now - i*7d) for i in 0..WEEKS_SHOWN-1.
  const weeklyWords = new Array<number>(WEEKS_SHOWN).fill(0);
  let piecesThisMonth = 0;
  let wordsThisMonth = 0;

  for (const d of drafts) {
    const updated = Date.parse(d.updated_at);
    if (Number.isNaN(updated)) continue;
    if (updated >= monthStart) {
      piecesThisMonth += 1;
      wordsThisMonth += d.word_count;
    }
    const weeksAgo = Math.floor((now.getTime() - updated) / (7 * DAY_MS));
    if (weeksAgo >= 0 && weeksAgo < WEEKS_SHOWN) {
      weeklyWords[WEEKS_SHOWN - 1 - weeksAgo] += d.word_count;
    }
  }

  let weekStreak = 0;
  for (let i = WEEKS_SHOWN - 1; i >= 0; i -= 1) {
    if (weeklyWords[i] > 0) weekStreak += 1;
    else break;
  }

  return { piecesThisMonth, wordsThisMonth, weekStreak, weeklyWords };
}

export function WritingStats({ drafts }: { drafts: DraftSummary[] }): JSX.Element | null {
  const stats = useMemo(() => computeStats(drafts), [drafts]);
  const peak = Math.max(...stats.weeklyWords, 1);

  if (drafts.length === 0) return null;

  return (
    <aside className="nb-card px-5 py-4 mt-6 flex items-center gap-6 flex-wrap">
      <Stat label="pieces this month" value={stats.piecesThisMonth.toLocaleString()} />
      <Divider />
      <Stat label="words this month" value={fmtCount(stats.wordsThisMonth)} />
      <Divider />
      <Stat label="week streak" value={String(stats.weekStreak)} accent={stats.weekStreak >= 2} />

      <div className="ml-auto flex items-end gap-2.5" aria-hidden>
        {stats.weeklyWords.map((words, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static 8-slot week buckets have no stable id.
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-2 rounded-t-sm transition-all duration-500 ${
                words > 0 ? "bg-cobalt-400" : "bg-rule/60"
              }`}
              style={{
                height: `${Math.max(words > 0 ? 4 : 2, Math.round((words / peak) * 28))}px`,
              }}
            />
            {i === stats.weeklyWords.length - 1 && (
              <span className="text-[9px] uppercase tracking-wide text-muted-2">now</span>
            )}
          </div>
        ))}
      </div>
      <span className="sr-only">
        Weekly writing volume for the last {WEEKS_SHOWN} weeks, current streak {stats.weekStreak}{" "}
        {stats.weekStreak === 1 ? "week" : "weeks"}.
      </span>
    </aside>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={`font-serif text-xl font-medium tabular-nums tracking-tight ${
          accent ? "text-cobalt-700" : "text-ink"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-muted whitespace-nowrap">{label}</span>
    </div>
  );
}

function Divider(): JSX.Element {
  return <span aria-hidden className="w-px h-6 bg-rule self-center hidden sm:block" />;
}

/** 12400 → "12.4k", 850 → "850". */
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}
