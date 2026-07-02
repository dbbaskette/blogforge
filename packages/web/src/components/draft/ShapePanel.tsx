import { useCallback, useEffect, useMemo, useState } from "react";

import { type Draft, inlineEdit } from "../../api/drafts";
import {
  type SuggestKind,
  type SuggestResult,
  type Suggestion,
  suggestImprovements,
} from "../../api/suggest";
import { formatAgo, getCached, hashDraftContent, setCached } from "../../lib/panelCache";
import { BusyOverlay } from "../ui/BusyOverlay";
import { useDialogA11y } from "../ui/useDialogA11y";

const KIND_META: Record<SuggestKind, { icon: string; label: string; hint: string }> = {
  fact_check: {
    icon: "🔍",
    label: "Worth verifying",
    hint: "Claims a careful editor would double-check. The model flags what to verify — it can't confirm truth, and it can be wrong.",
  },
  reword: {
    icon: "✏️",
    label: "Reword",
    hint: "Sharper alternatives, kept in your voice. Pick one to apply it.",
  },
  expand: {
    icon: "➕",
    label: "Expand",
    hint: "Spots that would land harder with a concrete example, number, or counterpoint.",
  },
};
const ORDER: SuggestKind[] = ["fact_check", "reword", "expand"];

const keyOf = (kind: SuggestKind, s: Suggestion): string => `${kind}::${s.target}`;

export function ShapePanel({
  draft,
  onSectionSave,
  onClose,
  autoRun = false,
}: {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onClose: () => void;
  autoRun?: boolean;
}): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const contentHash = useMemo(() => hashDraftContent(draft), [draft]);

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCachedAt(null);
    try {
      const fresh = await suggestImprovements(draft.id);
      setResult(fresh);
      setCached("shape", draft.id, hashDraftContent(draft), fresh);
      setDismissed(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  // On open: reuse the last result if the draft is unchanged (even when not
  // auto-offered); otherwise auto-run only when offered. Re-run bypasses cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const hit = getCached<SuggestResult>("shape", draft.id, contentHash);
    if (hit) {
      setResult(hit.data);
      setCachedAt(hit.at);
    } else if (autoRun) {
      run();
    }
  }, []);

  const dismiss = (key: string): void => setDismissed((p) => new Set(p).add(key));

  /** Splice `replacement` in for the first exact occurrence of `target`. */
  function spliceSection(target: string, replacement: string): { id: string; next: string } | null {
    const section = draft.sections.find((s) => s.content_md.includes(target));
    if (!section) return null;
    const idx = section.content_md.indexOf(target);
    const next =
      section.content_md.slice(0, idx) +
      replacement +
      section.content_md.slice(idx + target.length);
    return { id: section.id, next };
  }

  const NOT_FOUND = "Couldn't find that passage — it may have changed. Edit it directly.";

  async function applyReword(s: Suggestion, option: string): Promise<void> {
    const key = keyOf("reword", s);
    const spliced = spliceSection(s.target, option);
    if (!spliced) {
      setNotice(NOT_FOUND);
      return;
    }
    setApplyingKey(key);
    setNotice(null);
    try {
      await onSectionSave(spliced.id, spliced.next);
      dismiss(key);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function applyExpand(s: Suggestion, idea: string): Promise<void> {
    const key = keyOf("expand", s);
    setApplyingKey(key);
    setNotice(null);
    try {
      const { text } = await inlineEdit(draft.id, {
        text: s.target,
        action: "custom",
        instruction: `Expand this passage with more substance. ${idea} Keep the author's voice; return only the rewritten passage.`,
      });
      const spliced = spliceSection(s.target, text.trim());
      if (!spliced) {
        setNotice(NOT_FOUND);
        return;
      }
      await onSectionSave(spliced.id, spliced.next);
      dismiss(key);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  function visibleFor(kind: SuggestKind): Suggestion[] {
    return (result?.[kind] ?? []).filter((s) => !dismissed.has(keyOf(kind, s)));
  }

  const total = result ? ORDER.reduce((n, k) => n + visibleFor(k).length, 0) : 0;
  const hasRun = result !== null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Shape Assistant"
      className="fixed right-0 top-0 z-30 h-full w-[440px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      {applyingKey && (
        <BusyOverlay
          label={applyingKey.startsWith("expand") ? "Expanding with AI…" : "Applying the rewrite…"}
        />
      )}
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            Shape Assistant
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Analyzing…" : hasRun ? "Re-run" : "Analyze"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <h2 className="mt-1 font-serif text-2xl font-medium text-ink tracking-tight">
          Shape your draft {total > 0 && <span className="text-cobalt-600">· {total}</span>}
        </h2>
        {cachedAt !== null && !busy && (
          <p className="mt-1 text-xs text-muted-2">
            Suggested {formatAgo(cachedAt)} · draft unchanged since
          </p>
        )}
      </header>

      {error && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fbf1de", border: "1px solid #f3d89b", color: "#92600a" }}
        >
          {notice}
        </div>
      )}

      {!error && (
        <div className="p-6 space-y-6">
          {!hasRun && !busy && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Run a voice-aware pass over your draft for claims worth verifying, sharper wordings,
                and places to add substance. Nothing changes until you apply it.
              </p>
              <button type="button" onClick={run} className="nb-btn nb-btn-primary">
                ✨ Shape this draft
              </button>
            </div>
          )}

          {busy && <p className="py-10 text-center text-sm text-muted">Analyzing your draft…</p>}

          {hasRun && !busy && total === 0 && (
            <p className="py-10 text-center text-sm text-muted">
              Nothing flagged — this draft reads clean. ✨
            </p>
          )}

          {hasRun &&
            ORDER.map((kind) => {
              const items = visibleFor(kind);
              if (items.length === 0) return null;
              const meta = KIND_META[kind];
              return (
                <section key={kind} className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">
                      <span aria-hidden="true">{meta.icon}</span> {meta.label}{" "}
                      <span className="text-muted font-normal">· {items.length}</span>
                    </h3>
                    <p className="text-xs text-muted leading-snug mt-0.5">{meta.hint}</p>
                  </div>
                  {items.map((s) => {
                    const key = keyOf(kind, s);
                    const applying = applyingKey === key;
                    return (
                      <div key={key} className="glass-card p-3 space-y-2">
                        <p className="text-sm text-ink-2 border-l-2 border-rule pl-2 italic leading-snug">
                          {s.target}
                        </p>
                        {s.note && <p className="text-xs text-muted leading-snug">{s.note}</p>}

                        {kind === "fact_check" && (
                          <button
                            type="button"
                            className="nb-btn nb-btn-ghost nb-btn-sm"
                            onClick={() => dismiss(key)}
                          >
                            Mark checked
                          </button>
                        )}

                        {kind === "reword" && (
                          <div className="flex flex-wrap gap-1.5">
                            {s.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                disabled={applying}
                                onClick={() => applyReword(s, opt)}
                                className="text-left text-sm px-2 py-1 rounded-nb-sm border border-rule hover:border-cobalt-400 hover:bg-cobalt-50 transition-colors disabled:opacity-50"
                              >
                                {opt}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="nb-btn nb-btn-ghost nb-btn-sm"
                              onClick={() => dismiss(key)}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}

                        {kind === "expand" && (
                          <div className="flex flex-wrap gap-1.5">
                            {(s.options.length
                              ? s.options
                              : ["Add a concrete example or detail."]
                            ).map((idea) => (
                              <button
                                key={idea}
                                type="button"
                                disabled={applying}
                                onClick={() => applyExpand(s, idea)}
                                className="text-left text-sm px-2 py-1 rounded-nb-sm border border-rule hover:border-cobalt-400 hover:bg-cobalt-50 transition-colors disabled:opacity-50"
                              >
                                {applying ? "Expanding…" : `➕ ${idea}`}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="nb-btn nb-btn-ghost nb-btn-sm"
                              onClick={() => dismiss(key)}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
