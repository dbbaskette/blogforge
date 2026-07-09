/**
 * Two-pane Humanize mode — shell mirrors OptimizePanel: the draft on the LEFT
 * (read view, heat-mapped where a finding's target sits) and the pulse/radar/
 * rhythm readouts + HumanizeReviewRail on the RIGHT. The header (mark, title,
 * intensity dial, HumannessPulse) is unchanged from the single-pane version.
 * Runs an on-demand "sound human" pass at the chosen Light/Medium/Strong
 * intensity, cached per content+intensity the same way OptimizePanel caches GEO.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { type Draft, lintDraft } from "../../api/drafts";
import { humanityScore } from "../../lib/checkup";
import {
  type HumanizeFinding,
  type HumanizeReport,
  type Intensity,
  analyzeHumanize,
} from "../../api/humanize";
import { hashDraftContent, peekCached, setCached } from "../../lib/panelCache";
import { findHighlight } from "../review/HighlightedText";
import { Icon } from "../ui/Icon";
import { InlineMarkdown } from "../ui/InlineMarkdown";
import { useDialogA11y } from "../ui/useDialogA11y";
import { HumanizeReviewRail } from "./HumanizeReviewRail";
import { HumannessPulse } from "./HumannessPulse";
import { LensBloom, type LensKey } from "./LensBloom";
import { RhythmStrip } from "./RhythmStrip";
import type { TrackedChangeKind } from "./trackedChangeDecoration";

interface HumanizePanelProps {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onClose: () => void;
}

const INTENSITIES: { value: Intensity; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "/humanize/robot.png" },
  { value: "medium", label: "Medium", icon: "/humanize/half.png" },
  { value: "strong", label: "Strong", icon: "/humanize/human.png" },
];

const LENS_KEYS: LensKey[] = ["flow", "voice", "imperfections", "soul"];

const intensityKey = (draftId: string): string => `bf.humanize.intensity.${draftId}`;

function readSavedIntensity(draftId: string): Intensity {
  const saved = localStorage.getItem(intensityKey(draftId));
  return saved === "light" || saved === "medium" || saved === "strong" ? saved : "medium";
}

/** Which lenses this pass covered — feeds the radar's engaged axes. */
function engagedLenses(report: HumanizeReport | null): LensKey[] {
  if (!report) return [];
  return report.lenses
    .map((l) => l.key)
    .filter((k): k is LensKey => (LENS_KEYS as string[]).includes(k));
}

/** Open-finding count per lens, defaulting absent lenses to 0 — feeds the
 *  radar's per-axis reach. */
function countsByLens(report: HumanizeReport | null): Record<LensKey, number> {
  const counts: Record<LensKey, number> = { flow: 0, voice: 0, imperfections: 0, soul: 0 };
  if (!report) return counts;
  for (const lens of report.lenses) {
    if ((LENS_KEYS as string[]).includes(lens.key))
      counts[lens.key as LensKey] = lens.findings.length;
  }
  return counts;
}

/** A located run to paint in the read pane. */
interface Mark {
  start: number;
  end: number;
  kind: TrackedChangeKind;
}

/** Locate every finding's target in a passage (the passive amber "under-review"
 *  heat-map wash) plus whichever one the rail is actively pointing at (which
 *  wins ties against the passive wash, so its own kind — locate/under-review —
 *  shows through). Reuses HighlightedText's tolerant matcher; only the
 *  multi-mark interleaving below is local, since HighlightedText itself only
 *  paints a single run at a time. */
function markRanges(
  text: string,
  findings: HumanizeFinding[],
  active: { text: string; kind: TrackedChangeKind } | null,
): Mark[] {
  const candidates: { needle: string; kind: TrackedChangeKind }[] = [];
  // The heat-map paints every finding amber. "Jump to" (locate) adds NO mark of
  // its own — the sentence is already in the heat-map, so jumping just scrolls +
  // rings the section. Only an applied fix ("under-review") paints an extra mark,
  // since its rewritten text isn't one of the finding targets.
  if (active && active.kind === "under-review") {
    candidates.push({ needle: active.text, kind: active.kind });
  }
  for (const f of findings) candidates.push({ needle: f.target, kind: "under-review" });

  const found: Mark[] = [];
  for (const c of candidates) {
    const hit = findHighlight(text, c.needle);
    if (hit) found.push({ ...hit, kind: c.kind });
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Mark[] = [];
  for (const m of found) {
    const last = merged[merged.length - 1];
    if (last && m.start < last.end) continue; // overlap — the higher-priority (earlier) mark wins
    merged.push(m);
  }
  return merged;
}

/** Render `text` with every located mark painted in. */
function HeatMapPassage({ text, marks }: { text: string; marks: Mark[] }): JSX.Element {
  if (marks.length === 0) return <>{text}</>;
  const nodes: JSX.Element[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.start > cursor) {
      nodes.push(<span key={`t${cursor}-${m.start}`}>{text.slice(cursor, m.start)}</span>);
    }
    nodes.push(
      <mark key={`m${m.start}-${m.end}`} className={`tracked-change tracked-change--${m.kind}`}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  }
  if (cursor < text.length) nodes.push(<span key={`t${cursor}-end`}>{text.slice(cursor)}</span>);
  return <>{nodes}</>;
}

// Amber box around an APPLIED fix awaiting accept — shows the pending change
// (its rewritten text isn't part of the heat-map).
const LIT_BOX = "rounded-nb ring-2 ring-amber/60 bg-amber-soft px-3 -mx-3 py-2";
// Transient cobalt ring for "Jump to" — briefly frames the sentence you jumped
// to (the amber heat-map wash is already there); cleared by the locate timeout.
const LOCATE_RING = "rounded-nb ring-2 ring-cobalt-400/70 px-3 -mx-3 py-2 transition-all";

export function HumanizePanel({ draft, onSectionSave, onClose }: HumanizePanelProps): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [intensity, setIntensity] = useState<Intensity>(() => readSavedIntensity(draft.id));
  const [report, setReport] = useState<HumanizeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The saved pass predates the current content — kept until an explicit re-run.
  const [stale, setStale] = useState(false);
  // The anti-robot sub-score from the (fast, deterministic) lint pass — the
  // same number Checkup blends, so the two meters agree.
  const [antiRobot, setAntiRobot] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    lintDraft(draft.id)
      .then((l) => {
        if (cancelled) return;
        setAntiRobot(humanityScore(l.violations.length + l.repetitions.length, l.hits.length));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draft.id]);

  // Which passage is lit in the read pane: an applied fix awaiting accept
  // ("under-review"), or a transient "locate" from the Highlight action.
  const [highlight, setHighlight] = useState<{
    sectionId: string;
    text: string;
    kind: TrackedChangeKind;
  } | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const locateTimer = useRef<number | null>(null);

  const onHighlight = useCallback(
    (sectionId: string, text: string | null, kind: "under-review" | "locate"): void => {
      if (locateTimer.current) window.clearTimeout(locateTimer.current);
      if (!text) {
        setHighlight(null);
        return;
      }
      setHighlight({ sectionId, text, kind });
      // Locate is transient; an under-review highlight persists until accept/undo.
      if (kind === "locate") {
        locateTimer.current = window.setTimeout(() => setHighlight(null), 1400);
      }
    },
    [],
  );

  // Scroll the lit passage into view whenever the highlight changes.
  useEffect(() => {
    if (highlight) {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  // Run the pass on mount and whenever the INTENSITY (dial) changes — but NOT on
  // every draft-content change. Accepting an AI fix mutates the draft, and if we
  // re-ran here on that, one accepted fix would re-analyze the whole post and
  // churn all the other findings under the writer. Accepted findings are already
  // resolved locally by the rail; a fresh pass is an explicit act (change the
  // dial, or reopen the panel). The cache key still uses the content hash, so a
  // reopen after edits does get a fresh read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed to draft.id + intensity, not draft content — see comment above
  useEffect(() => {
    let cancelled = false;
    const key = `${hashDraftContent(draft)}:${intensity}`;
    // Restore the saved pass for THIS dial position, regardless of edits since —
    // reopening never silently re-runs the (paid) model pass. Only an explicit
    // Re-analyze or a dial change triggers a fresh run. `stale` flags an edit.
    const saved = peekCached<HumanizeReport>("humanize", draft.id);
    if (saved && saved.data.intensity === intensity) {
      setReport(saved.data);
      setError(null);
      setLoading(false);
      setStale(saved.hash !== key);
      return;
    }
    setLoading(true);
    setError(null);
    setStale(false);
    analyzeHumanize(draft.id, intensity)
      .then((r) => {
        // ALWAYS cache — even if the panel closed mid-run. The pass costs a
        // model call; reopening the panel then picks it up instantly instead
        // of throwing the finished work away.
        setCached("humanize", draft.id, key, r);
        if (cancelled) return;
        setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.id, intensity]);

  // Manual re-analyze — the only path that re-pays for a pass at the current
  // dial position, replacing the saved (now stale) one.
  const rerun = useCallback((): void => {
    const key = `${hashDraftContent(draft)}:${intensity}`;
    setLoading(true);
    setError(null);
    analyzeHumanize(draft.id, intensity)
      .then((r) => {
        setCached("humanize", draft.id, key, r);
        setReport(r);
        setStale(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [draft, intensity]);

  const selectIntensity = useCallback(
    (next: Intensity): void => {
      localStorage.setItem(intensityKey(draft.id), next);
      setIntensity(next);
    },
    [draft.id],
  );

  const engaged = useMemo(() => engagedLenses(report), [report]);
  const counts = useMemo(() => countsByLens(report), [report]);

  // The section content the rhythm strip reads sentence lengths from: every
  // section's body plus the opening hook, in article order.
  const draftText = useMemo(() => {
    const parts: string[] = [];
    if (draft.outline?.opening_hook) parts.push(draft.outline.opening_hook);
    for (const s of draft.sections) if (s.content_md) parts.push(s.content_md);
    return parts.join(" ");
  }, [draft]);

  const findingsBySection = useMemo(() => {
    const map = new Map<string, HumanizeFinding[]>();
    if (!report) return map;
    for (const lens of report.lenses) {
      for (const f of lens.findings) {
        const list = map.get(f.section_id) ?? [];
        list.push(f);
        map.set(f.section_id, list);
      }
    }
    return map;
  }, [report]);

  const opening = draft.outline?.opening_hook?.trim() ?? "";
  const openingLit = highlight?.sectionId === "opening";
  // An applied fix awaiting accept gets the amber box; a "Jump to" locate gets a
  // transient cobalt ring (the heat-map amber is already on the sentence).
  const boxFor = (isLit: boolean): string =>
    !isLit ? "" : highlight?.kind === "under-review" ? LIT_BOX : LOCATE_RING;

  // Passive heat-map marks per section, memoized on content + findings only.
  // Highlight state changes (Jump to / accept / undo) then re-run the tolerant
  // substring matcher for just the ACTIVE section instead of the whole draft.
  const passiveMarks = useMemo(() => {
    const map = new Map<string, Mark[]>();
    if (opening) map.set("opening", markRanges(opening, findingsBySection.get("opening") ?? [], null));
    for (const s of draft.sections) {
      if (s.content_md?.trim()) {
        map.set(s.id, markRanges(s.content_md, findingsBySection.get(s.id) ?? [], null));
      }
    }
    return map;
  }, [draft, findingsBySection, opening]);
  const marksFor = (sid: string, text: string, lit: boolean): Mark[] =>
    lit && highlight
      ? markRanges(text, findingsBySection.get(sid) ?? [], {
          text: highlight.text,
          kind: highlight.kind,
        })
      : (passiveMarks.get(sid) ?? []);

  return (
    <div
      ref={panelRef}
      // biome-ignore lint/a11y/useSemanticElements: a full-screen mode overlay, not a native <dialog>; matches OptimizePanel
      role="dialog"
      aria-modal="true"
      aria-label="Humanize"
      className="fixed inset-0 z-40 flex flex-col bg-canvas overflow-hidden"
    >
      <header className="shrink-0 px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="max-w-md">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
              Humanize
            </p>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>

          <div className="mt-1 flex items-center gap-2.5">
            <img src="/humanize/mark.png" width={44} height={44} alt="humanize" />
            <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">Sound human</h2>
          </div>
          <Link
            to="/help#humanize"
            className="mt-1 inline-block text-xs text-muted underline underline-offset-2 hover:text-ink"
          >
            How these rules work →
          </Link>

          {stale && !loading && (
            <p className="mt-2 text-xs text-amber-ink">
              <span aria-hidden>✎</span> Draft edited since this pass ·{" "}
              <button
                type="button"
                onClick={rerun}
                className="font-medium underline underline-offset-2 hover:text-ink"
              >
                Re-analyze
              </button>
            </p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-1.5" role="group" aria-label="Intensity">
            {INTENSITIES.map((opt) => {
              const active = intensity === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectIntensity(opt.value)}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1 rounded-nb-sm px-2 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-cobalt-50 text-cobalt-700 ring-1 ring-cobalt-300"
                      : "text-muted hover:text-ink hover:bg-card-2"
                  }`}
                >
                  <img
                    src={opt.icon}
                    alt={opt.label}
                    width={28}
                    height={28}
                    style={{ mixBlendMode: "multiply" }}
                  />
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <HumannessPulse
              antiRobot={antiRobot ?? 88 /* momentary placeholder until the lint pass resolves */}
              humanSignal={report ? report.score : null}
            />
          </div>
        </div>
      </header>

      {error && (
        <div
          className="mx-6 mt-4 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}

      {/* Two-column body: heat-mapped draft on the left, radar/rhythm + rail on the right. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left pane — read view of the draft, painted with every open finding */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-4 lg:px-8 py-6">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-serif text-2xl md:text-3xl font-medium text-ink leading-tight tracking-tight mb-6">
              {draft.title.trim() ? (
                <InlineMarkdown text={draft.title} />
              ) : (
                <span className="text-muted-2">Untitled draft</span>
              )}
            </h2>

            {opening && (
              <p
                ref={openingLit ? highlightRef : undefined}
                className={`text-ink leading-relaxed whitespace-pre-wrap mb-8 ${boxFor(openingLit)}`}
              >
                <HeatMapPassage text={opening} marks={marksFor("opening", opening, openingLit)} />
              </p>
            )}

            <div className="space-y-8">
              {draft.sections.map((section) => {
                const lit = highlight?.sectionId === section.id;
                return (
                  <section key={section.id}>
                    {section.title.trim() && (
                      <h3 className="font-serif text-xl font-medium text-ink mb-3">
                        {section.title}
                      </h3>
                    )}
                    <div
                      ref={lit ? highlightRef : undefined}
                      className={`prose text-ink leading-relaxed whitespace-pre-wrap ${boxFor(lit)}`}
                    >
                      {section.content_md?.trim() ? (
                        <HeatMapPassage
                          text={section.content_md}
                          marks={marksFor(section.id, section.content_md, lit)}
                        />
                      ) : (
                        <span className="text-muted-2 not-italic">No content yet.</span>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right pane — radar + rhythm, then the Humanize review rail */}
        <aside className="w-full lg:w-[380px] shrink-0 border-t lg:border-t-0 lg:border-l border-rule bg-card/40 overflow-y-auto px-4 lg:px-5 py-6 space-y-4">
          <div className="glass-card p-3 space-y-3">
            <LensBloom engaged={engaged} counts={counts} />
            <RhythmStrip text={draftText} />
          </div>

          {loading && !report ? (
            <p className="py-10 text-center text-sm text-muted">Reading for robotic tells…</p>
          ) : report ? (
            <HumanizeReviewRail
              report={report}
              draft={draft}
              onSectionSave={onSectionSave}
              onHighlight={onHighlight}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
