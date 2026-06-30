import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";

import {
  type ClaimResult,
  type Draft,
  type LintFinding,
  checkClaims,
  inlineEdit,
  lintDraft,
} from "../../api/drafts";
import { useElapsed } from "../../hooks/useElapsed";
import { dismiss as dismissFinding, loadDismissed, restore } from "../../lib/lintDismissals";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";

interface LintPanelProps {
  draft: Draft;
  /** Persist a section's new markdown (applies an accepted fix). */
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onClose: () => void;
}

/** Expand [start,end) to its enclosing sentence so the AI rewrites with context. */
function enclosingSpan(text: string, start: number, end: number): { s: number; e: number } {
  const boundary = (c: string): boolean => c === "." || c === "!" || c === "?" || c === "\n";
  let s = start;
  while (s > 0 && !boundary(text[s - 1])) s--;
  while (s < start && /\s/.test(text[s])) s++;
  let e = end;
  while (e < text.length && !boundary(text[e])) e++;
  if (e < text.length) e++; // include the closing punctuation
  return { s, e };
}

/** Scroll the editor to a section and flash it. */
function jumpToSection(sectionId: string): void {
  const el = document.getElementById(`section-${sectionId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("lint-flash");
  window.setTimeout(() => el.classList.remove("lint-flash"), 1600);
}

/** Build a fix instruction that names the exact flagged text, so the model
 * actually removes it instead of vaguely "avoiding the flagged wording". */
function fixInstruction(finding: LintFinding): string {
  if (finding.kind === "repetition") {
    return "Rewrite this sentence to remove the repeated phrasing, keeping the meaning and the author's voice. Do not use em dashes. Return only the rewritten sentence.";
  }
  const target = finding.match ? `the flagged text "${finding.match}"` : "the flagged wording";
  return `Rewrite this sentence to remove ${target}, recasting it naturally while keeping the meaning and the author's voice. Do not use em dashes. Return only the rewritten sentence.`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Humanity Score 0–100. Starts at 100, docks 6 per still-open finding, then
 * nudges up by 2 per positive voice hit (capped, so a tell-ridden draft can't
 * be bought back to clean). 0 open findings ⇒ 100 ⇒ celebratory state.
 */
function humanityScore(openCount: number, hitCount: number): number {
  const base = 100 - openCount * 6;
  const bonus = openCount === 0 ? 0 : Math.min(hitCount * 2, 10);
  return clamp(base + bonus, 0, 100);
}

/** coral (low) → amber (mid) → leaf/green (high) */
function scoreColor(score: number): string {
  if (score >= 70) return "#0e7a50"; // leaf/green-ink
  if (score >= 45) return "#92600a"; // amber
  return "#b5321b"; // coral
}

function HumanityRing({
  openCount,
  hitCount,
}: {
  openCount: number;
  hitCount: number;
}): JSX.Element {
  const score = humanityScore(openCount, hitCount);
  const color = scoreColor(score);
  const clean = openCount === 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - score / 100);

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[68px] w-[68px] shrink-0">
        <svg
          viewBox="0 0 68 68"
          className="h-full w-full -rotate-90"
          aria-hidden="true"
        >
          <circle cx="34" cy="34" r={R} fill="none" stroke="#e7e3da" strokeWidth="6" />
          <circle
            cx="34"
            cy="34"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 600ms ease, stroke 400ms ease" }}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-serif text-xl font-medium tabular-nums"
          style={{ color }}
        >
          {score}
        </span>
        {clean && (
          <span className="pointer-events-none absolute inset-0" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full animate-confetti-burst"
                style={
                  {
                    background: i % 2 === 0 ? "#0e7a50" : "#2f6bff",
                    "--burst-angle": `${i * 60}deg`,
                    animationDelay: `${i * 40}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
          Humanity
        </p>
        {clean ? (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-nb-sm px-2 py-0.5 text-xs font-medium animate-fade-in"
            style={{ background: "#d9f2e5", color: "#0e7a50" }}
          >
            ✓ Clean — reads human
          </span>
        ) : (
          <p className="mt-0.5 text-xs text-muted leading-snug">
            AI tells remaining: <span className="font-medium text-ink-2 tabular-nums">{openCount}</span>
          </p>
        )}
      </div>
      <style>{`
        @keyframes confetti-burst {
          0%   { transform: translate(-50%, -50%) rotate(var(--burst-angle)) translateY(0) scale(0.4); opacity: 0; }
          35%  { opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(var(--burst-angle)) translateY(-26px) scale(1); opacity: 0; }
        }
        .animate-confetti-burst { animation: confetti-burst 900ms ease-out forwards; }
      `}</style>
    </div>
  );
}

export function LintPanel({ draft, onSectionSave, onClose }: LintPanelProps): JSX.Element {
  const draftId = draft.id;
  const [loading, setLoading] = useState(true);
  const [violations, setViolations] = useState<LintFinding[]>([]);
  const [repetitions, setRepetitions] = useState<LintFinding[]>([]);
  const [hits, setHits] = useState<LintFinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(draftId));
  const [showDismissed, setShowDismissed] = useState(false);

  const [claims, setClaims] = useState<ClaimResult[] | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [hasRefs, setHasRefs] = useState(true);
  // Findings the user just accepted/applied — hidden immediately so the list
  // clears as you go; reset whenever a fresh lint replaces the truth.
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const runLint = useCallback(() => {
    setLoading(true);
    lintDraft(draftId)
      .then((r) => {
        setViolations(r.violations);
        setRepetitions(r.repetitions ?? []);
        setHits(r.hits);
        setResolved(new Set());
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [draftId]);

  useEffect(() => runLint(), [runLint]);

  const onDismiss = (id: string): void => setDismissed(dismissFinding(draftId, id));
  const onRestore = (id: string): void => setDismissed(restore(draftId, id));

  const actionable = useMemo(
    () => [...violations, ...repetitions],
    [violations, repetitions],
  );
  const visible = actionable.filter((f) => !dismissed.has(f.id) && !resolved.has(f.id));
  const hiddenCount = actionable.length - visible.length;

  const runClaims = async (): Promise<void> => {
    setClaimsLoading(true);
    setClaimsError(null);
    try {
      const { claims: c, has_references } = await checkClaims(draftId);
      setClaims(c);
      setHasRefs(has_references);
    } catch (e) {
      setClaimsError((e as Error).message);
    } finally {
      setClaimsLoading(false);
    }
  };

  const panelRef = useDialogA11y(true, onClose);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      className="fixed right-0 top-0 z-30 h-full w-[420px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
      aria-label="Proofreader"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            Proofreader
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={runLint} className="nb-btn nb-btn-ghost nb-btn-sm" disabled={loading}>
              {loading ? "Linting…" : "Re-lint"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between gap-4">
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">
            Review {visible.length > 0 && <span className="text-coral">· {visible.length}</span>}
          </h2>
          {!error && !(loading && visible.length === 0) && (
            <HumanityRing openCount={visible.length} hitCount={hits.length} />
          )}
        </div>
      </header>

      {error && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}

      {!error && (
        <div className="p-6 space-y-4">
          {loading && visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Running lint…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted italic font-serif py-6 text-center">
              Nothing flagged — clean copy.
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  draft={draft}
                  onSectionSave={onSectionSave}
                  onDismiss={() => onDismiss(f.id)}
                  onApplied={runLint}
                  onResolved={() => setResolved((p) => new Set(p).add(f.id))}
                />
              ))}
            </ul>
          )}

          {hiddenCount > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowDismissed((v) => !v)}
                className="text-xs font-medium text-muted hover:text-ink underline underline-offset-2"
              >
                {showDismissed ? "Hide" : "Show"} dismissed ({hiddenCount})
              </button>
              {showDismissed && (
                <ul className="mt-2 space-y-1.5">
                  {actionable
                    .filter((f) => dismissed.has(f.id))
                    .map((f) => (
                      <li key={f.id} className="flex items-center gap-2 text-xs text-muted">
                        <span className="truncate flex-1">{f.message}</span>
                        <button
                          type="button"
                          onClick={() => onRestore(f.id)}
                          className="text-cobalt-600 hover:text-cobalt-700 shrink-0"
                        >
                          restore
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {hits.length > 0 && (
            <details className="pt-2">
              <summary className="text-xs font-semibold uppercase tracking-wider text-green-ink cursor-pointer">
                Positive hits ({hits.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {hits.map((h) => (
                  <li key={h.id} className="text-xs text-ink-2">
                    {h.section_id && (
                      <button
                        type="button"
                        onClick={() => h.section_id && jumpToSection(h.section_id)}
                        className="text-cobalt-600 hover:text-cobalt-700 mr-1"
                      >
                        ↪
                      </button>
                    )}
                    {h.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <hr className="nb-rule" />
          <FactCheck
            claims={claims}
            loading={claimsLoading}
            error={claimsError}
            hasRefs={hasRefs}
            onRun={runClaims}
          />
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  draft,
  onSectionSave,
  onDismiss,
  onApplied,
  onResolved,
}: {
  finding: LintFinding;
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onDismiss: () => void;
  onApplied: () => void;
  onResolved: () => void;
}): JSX.Element {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const section = draft.sections.find((s) => s.id === finding.section_id);
  const accent =
    finding.kind === "violation"
      ? { border: "#f7c3b6", tag: "#b5321b" }
      : { border: "#f3d89b", tag: "#92600a" };

  // Locate the span in the current section content; null if it drifted.
  const locate = (): { s: number; e: number } | null => {
    if (!section) return null;
    const c = section.content_md;
    if (
      finding.start != null &&
      finding.end != null &&
      c.slice(finding.start, finding.end) === finding.match
    ) {
      return { s: finding.start, e: finding.end };
    }
    const idx = c.indexOf(finding.match);
    return idx >= 0 ? { s: idx, e: idx + finding.match.length } : null;
  };
  const located = section ? locate() : null;

  const aiFix = async (): Promise<void> => {
    if (!section || !located) return;
    setBusy(true);
    setErr(null);
    try {
      const span = enclosingSpan(section.content_md, located.s, located.e);
      const sentence = section.content_md.slice(span.s, span.e);
      const { text } = await inlineEdit(draft.id, {
        text: sentence,
        action: "custom", // custom honors `instruction`; preset actions ignore it
        instruction: fixInstruction(finding),
      });
      setSuggestion(text.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const accept = async (): Promise<void> => {
    if (!section || !located || suggestion == null) return;
    setBusy(true);
    setErr(null);
    try {
      const span = enclosingSpan(section.content_md, located.s, located.e);
      const next =
        section.content_md.slice(0, span.s) + suggestion + section.content_md.slice(span.e);
      await onSectionSave(section.id, next);
      setSuggestion(null);
      onResolved(); // remove this finding from the list right away
      onApplied(); // re-lint to refresh the rest
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="nb-card p-3 text-sm" style={{ borderLeft: `3px solid ${accent.border}` }}>
      <p className="text-ink-2 leading-snug">{finding.message}</p>
      {finding.match && (
        <p className="mt-1 font-mono text-[12px] text-muted truncate" title={finding.match}>
          “{finding.match}”
        </p>
      )}

      {suggestion != null ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-cobalt-600 mb-1">
            Suggested rewrite
          </p>
          <p className="font-serif text-[14px] text-ink bg-cobalt-50/60 rounded-nb-sm px-2.5 py-2 leading-snug">
            {suggestion}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={accept} disabled={busy} className="nb-btn nb-btn-primary nb-btn-sm">
              {busy ? "Applying…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              disabled={busy}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => finding.section_id && jumpToSection(finding.section_id)}
            disabled={!finding.section_id}
            className="nb-btn nb-btn-ghost nb-btn-sm"
          >
            Jump
          </button>
          <button
            type="button"
            onClick={aiFix}
            disabled={busy || !located}
            className="nb-btn nb-btn-sm"
            title={!located ? "Text changed — re-lint to refresh" : undefined}
          >
            {busy ? "Thinking…" : "AI fix"}
          </button>
          <button type="button" onClick={onDismiss} className="nb-btn nb-btn-ghost nb-btn-sm">
            Leave it
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-coral">{err}</p>}
    </li>
  );
}

function FactCheck({
  claims,
  loading,
  error,
  hasRefs,
  onRun,
}: {
  claims: ClaimResult[] | null;
  loading: boolean;
  error: string | null;
  hasRefs: boolean;
  onRun: () => void;
}): JSX.Element {
  const secs = useElapsed(loading);
  return (
    <section>
      <h3 className="font-serif text-lg font-medium text-ink tracking-tight">Fact-check</h3>
      <p className="text-xs text-muted mb-3">Checks the draft's claims against your references.</p>
      {error && <p className="text-sm text-coral mb-2">{error}</p>}
      {claims === null ? (
        <button type="button" onClick={onRun} disabled={loading} className="nb-btn nb-btn-sm">
          {loading ? `Checking… ${secs}s` : "Check claims"}
        </button>
      ) : (
        <>
          {!hasRefs && (
            <p
              className="text-xs px-3 py-2 rounded-nb-sm mb-2"
              style={{ background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }}
            >
              No references attached — every claim is flagged as needing a source.
            </p>
          )}
          {claims.length === 0 ? (
            <p className="text-sm text-muted italic font-serif">No checkable claims found.</p>
          ) : (
            <ul className="space-y-2">
              {claims.map((c, i) => (
                <li
                  key={`claim-${i}-${c.text.slice(0, 24)}`}
                  className="nb-card p-3 text-sm"
                  style={{ borderColor: CLAIM_BORDER[c.status] }}
                >
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider mr-2"
                    style={{ color: CLAIM_COLOR[c.status] }}
                  >
                    [{c.status}]
                  </span>
                  <span className="text-ink-2">{c.text}</span>
                  {c.note && <p className="text-xs text-muted mt-1">{c.note}</p>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onRun} disabled={loading} className="nb-btn nb-btn-ghost nb-btn-sm mt-2">
            {loading ? `Checking… ${secs}s` : "Re-check"}
          </button>
        </>
      )}
    </section>
  );
}

const CLAIM_BORDER: Record<ClaimResult["status"], string> = {
  supported: "#c2e6d2",
  unsupported: "#f3d89b",
  contradicted: "#f7c3b6",
};
const CLAIM_COLOR: Record<ClaimResult["status"], string> = {
  supported: "#0e7a50",
  unsupported: "#92600a",
  contradicted: "#b5321b",
};
