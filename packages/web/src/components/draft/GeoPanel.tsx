import { useCallback, useEffect, useState } from "react";

import { type Draft, type Section, inlineEdit } from "../../api/drafts";
import {
  type GeoFinding,
  type GeoLever,
  type GeoReport,
  analyzeGeo,
  generateFaq,
} from "../../api/geo";
import { useDialogA11y } from "../ui/useDialogA11y";

const FIX_LABEL: Record<string, string> = {
  answer_first: "Rewrite answer-first",
  question_heading: "Rephrase as a question",
  definitional: "Add a definitional opener",
  faq: "Generate an FAQ section",
};

function gradeColor(grade: string): { bg: string; fg: string; bd: string } {
  if (grade === "A" || grade === "B") return { bg: "#e3f5ec", fg: "#0e7a50", bd: "#bfe8d3" };
  if (grade === "C") return { bg: "#fbf1de", fg: "#92600a", bd: "#f3d89b" };
  return { bg: "#fde7e2", fg: "#b5321b", bd: "#f7c3b6" };
}

function barColor(score: number): string {
  if (score >= 72) return "#15a06b";
  if (score >= 58) return "#f59e0b";
  return "#e6492d";
}

const findingKey = (lever: GeoLever, f: GeoFinding): string =>
  `${lever.key}:${f.section_id || f.target || f.note}`;

const wordCount = (t: string): number => t.split(/\s+/).filter(Boolean).length;

export function GeoPanel({
  draft,
  onSectionSave,
  onChange,
  onClose,
}: {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onChange: (next: Draft) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [report, setReport] = useState<GeoReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState(false);

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setReport(await analyzeGeo(draft.id));
      setDone(new Set());
      setStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft.id]);

  // Auto-run when the panel opens — the writer clicked GEO to see the score.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    run();
  }, []);

  const markDone = (key: string): void => {
    setDone((p) => new Set(p).add(key));
    setStale(true);
  };

  async function fixSectionRewrite(
    key: string,
    sectionId: string,
    instruction: string,
  ): Promise<void> {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section) {
      setNotice("That section changed — re-analyze and try again.");
      return;
    }
    setApplyingKey(key);
    setNotice(null);
    try {
      const { text } = await inlineEdit(draft.id, {
        text: section.content_md,
        action: "custom",
        instruction,
      });
      await onSectionSave(section.id, text.trim());
      markDone(key);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function fixHeading(key: string, sectionId: string): Promise<void> {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section) {
      setNotice("That section changed — re-analyze and try again.");
      return;
    }
    setApplyingKey(key);
    setNotice(null);
    try {
      const { text } = await inlineEdit(draft.id, {
        text: section.title,
        action: "custom",
        instruction:
          "Rephrase this blog section heading as a concise question a reader would ask. End with a question mark. Return only the heading text.",
      });
      const title = text.trim().replace(/^#+\s*/, "");
      const nextSections = draft.sections.map((s) => (s.id === sectionId ? { ...s, title } : s));
      const nextOutline = draft.outline
        ? {
            ...draft.outline,
            sections: draft.outline.sections.map((o) => (o.id === sectionId ? { ...o, title } : o)),
          }
        : draft.outline;
      await onChange({ ...draft, sections: nextSections, outline: nextOutline });
      markDone(key);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function fixDefinitional(key: string): Promise<void> {
    const first = draft.sections[0];
    if (!first) return;
    await fixSectionRewrite(
      key,
      first.id,
      `Add ONE citable opening sentence that defines this post's subject in the form "<Subject> is a <category> that <does what>", then keep the existing text unchanged. Subject: ${draft.title}. Keep the author's voice. Return only the section body, no heading.`,
    );
  }

  async function fixFaq(key: string): Promise<void> {
    setApplyingKey(key);
    setNotice(null);
    try {
      const faqs = await generateFaq(draft.id);
      if (faqs.length === 0) {
        setNotice("No FAQ came back — try again.");
        return;
      }
      const id = crypto.randomUUID().replace(/-/g, "");
      const content = faqs.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n");
      const section: Section = {
        id,
        title: "FAQ",
        brief: "",
        content_md: content,
        status: "edited",
        last_generated_at: null,
        word_count: wordCount(content),
      };
      const nextOutline = draft.outline
        ? {
            ...draft.outline,
            sections: [...draft.outline.sections, { id, title: "FAQ", brief: "" }],
          }
        : { opening_hook: "", sections: [{ id, title: "FAQ", brief: "" }], estimated_words: 0 };
      await onChange({ ...draft, sections: [...draft.sections, section], outline: nextOutline });
      markDone(key);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  const grade = report ? gradeColor(report.grade) : gradeColor("F");

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="GEO optimizer"
      className="fixed right-0 top-0 z-30 h-full w-[460px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            GEO optimizer
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Analyzing…" : "Re-analyze"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div
            className="flex flex-col items-center justify-center rounded-nb-sm px-3 py-1.5 min-w-[4.5rem]"
            style={{ background: grade.bg, border: `1px solid ${grade.bd}`, color: grade.fg }}
          >
            <span className="text-2xl font-bold leading-none tabular-nums">
              {report?.score ?? "—"}
            </span>
            <span className="text-xs font-semibold">Grade {report?.grade ?? "—"}</span>
          </div>
          <p className="text-xs text-muted leading-snug">
            Structural GEO readiness — how extractable this draft is for AI answer engines.{" "}
            <span className="text-muted-2">
              Not a citation guarantee; off-page authority matters more.
            </span>
          </p>
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
      {notice && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fbf1de", border: "1px solid #f3d89b", color: "#92600a" }}
        >
          {notice}
        </div>
      )}
      {stale && !busy && (
        <div className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm bg-cobalt-50 text-cobalt-800">
          Applied a fix.{" "}
          <button type="button" onClick={run} className="underline">
            Re-analyze
          </button>{" "}
          to refresh your score.
        </div>
      )}

      {!error && (
        <div className="p-6 space-y-4">
          {busy && !report && (
            <p className="py-10 text-center text-sm text-muted">Scoring your draft…</p>
          )}

          {report?.levers.map((lever) => {
            const perFinding = lever.fix === "answer_first" || lever.fix === "question_heading";
            const leverLevelFix = lever.fix === "faq" || lever.fix === "definitional";
            const leverKey = lever.key;
            return (
              <section key={lever.key} className="glass-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">{lever.label}</h3>
                  <span
                    className="text-xs font-mono tabular-nums"
                    style={{ color: barColor(lever.score) }}
                  >
                    {lever.score}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-rule/60 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${lever.score}%`, background: barColor(lever.score) }}
                  />
                </div>
                <p className="text-xs text-muted leading-snug">{lever.detail}</p>

                {lever.findings.map((f) => {
                  const key = findingKey(lever, f);
                  if (done.has(key)) return null;
                  const applying = applyingKey === key;
                  return (
                    <div key={key} className="border-l-2 border-rule pl-2 space-y-1">
                      {f.target && (
                        <p className="text-xs italic text-ink-2 leading-snug">“{f.target}”</p>
                      )}
                      <p className="text-xs text-muted leading-snug">{f.note}</p>
                      {perFinding && f.section_id && (
                        <button
                          type="button"
                          disabled={applying}
                          onClick={() =>
                            lever.fix === "answer_first"
                              ? fixSectionRewrite(
                                  key,
                                  f.section_id as string,
                                  "Rewrite this section so it OPENS with a direct, self-contained answer of about 40-60 words, then the supporting detail. Keep the author's voice and all substance. Return only the section body, no heading.",
                                )
                              : fixHeading(key, f.section_id as string)
                          }
                          className="nb-btn nb-btn-ghost nb-btn-sm"
                        >
                          {applying ? "Applying…" : FIX_LABEL[lever.fix as string]}
                        </button>
                      )}
                    </div>
                  );
                })}

                {leverLevelFix && !done.has(leverKey) && (
                  <button
                    type="button"
                    disabled={applyingKey === leverKey}
                    onClick={() =>
                      lever.fix === "faq" ? fixFaq(leverKey) : fixDefinitional(leverKey)
                    }
                    className="nb-btn nb-btn-primary nb-btn-sm"
                  >
                    {applyingKey === leverKey ? "Applying…" : FIX_LABEL[lever.fix as string]}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
