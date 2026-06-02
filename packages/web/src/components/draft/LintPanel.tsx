import { useEffect, useState } from "react";

import { type ClaimResult, checkClaims, lintDraft } from "../../api/drafts";
import { Icon } from "../ui/Icon";

interface LintItem {
  text?: string;
  message?: string;
  rule?: string;
  [key: string]: unknown;
}

interface LintPanelProps {
  draftId: string;
  onClose: () => void;
}

function itemKey(item: LintItem, prefix: string, idx: number): string {
  const hint = item.rule ?? item.message ?? item.text ?? String(idx);
  return `${prefix}-${idx}-${hint}`;
}

export function LintPanel({ draftId, onClose }: LintPanelProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [violations, setViolations] = useState<LintItem[]>([]);
  const [repetitions, setRepetitions] = useState<LintItem[]>([]);
  const [hits, setHits] = useState<LintItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Claims are an LLM call (unlike the fast rule-based lint above), so they
  // run on demand — not on every panel open.
  const [claims, setClaims] = useState<ClaimResult[] | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [hasRefs, setHasRefs] = useState(true);

  useEffect(() => {
    setLoading(true);
    lintDraft(draftId)
      .then((result) => {
        setViolations(result.violations as LintItem[]);
        setRepetitions((result.repetitions ?? []) as LintItem[]);
        setHits(result.hits as LintItem[]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [draftId]);

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

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/30 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="w-[440px] max-w-full bg-canvas border-l border-rule-2 h-full overflow-y-auto shadow-nb-pop m-0 p-0 text-ink animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Lint results"
      >
        <header className="px-6 pt-6 pb-4 border-b border-rule bg-white sticky top-0 z-10">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
              Proofreader
            </p>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight mt-1">
            Lint results
          </h2>
        </header>

        {loading && <p className="px-6 py-12 text-center text-sm text-muted">Running lint…</p>}

        {error && (
          <div
            className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
            style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
          >
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="p-6 space-y-6">
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-serif text-lg font-medium text-ink tracking-tight">
                  Violations
                </h3>
                <span
                  className="nb-pill"
                  style={{
                    background: violations.length === 0 ? "#e3f5ec" : "#fde9ec",
                    color: violations.length === 0 ? "#1f7752" : "#94293c",
                  }}
                >
                  {violations.length.toString().padStart(2, "0")}
                </span>
              </div>
              {violations.length === 0 ? (
                <p className="text-sm text-muted italic font-serif">Clean copy.</p>
              ) : (
                <ul className="space-y-2">
                  {violations.map((v, i) => (
                    <li
                      key={itemKey(v, "violation", i)}
                      className="nb-card p-3 text-sm"
                      style={{ borderColor: "#f7c7cf" }}
                    >
                      {v.rule && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-rose mr-2">
                          [{v.rule}]
                        </span>
                      )}
                      <span className="text-ink-2">{v.message ?? v.text ?? JSON.stringify(v)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <hr className="nb-rule" />

            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-serif text-lg font-medium text-ink tracking-tight">
                  Repetition
                </h3>
                <span
                  className="nb-pill"
                  style={{
                    background: repetitions.length === 0 ? "#e3f5ec" : "#fdf6e6",
                    color: repetitions.length === 0 ? "#1f7752" : "#8a5d18",
                  }}
                >
                  {repetitions.length.toString().padStart(2, "0")}
                </span>
              </div>
              {repetitions.length === 0 ? (
                <p className="text-sm text-muted italic font-serif">
                  No recycled phrasing across sections.
                </p>
              ) : (
                <ul className="space-y-2">
                  {repetitions.map((r, i) => (
                    <li
                      key={itemKey(r, "rep", i)}
                      className="nb-card p-3 text-sm"
                      style={{ borderColor: "#f0d5a4" }}
                    >
                      {r.rule && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-700 mr-2">
                          [{r.rule}]
                        </span>
                      )}
                      <span className="text-ink-2">{r.message ?? r.text ?? JSON.stringify(r)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <hr className="nb-rule" />

            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-serif text-lg font-medium text-ink tracking-tight">
                  Positive hits
                </h3>
                <span className="nb-pill nb-pill-ready">
                  {hits.length.toString().padStart(2, "0")}
                </span>
              </div>
              {hits.length === 0 ? (
                <p className="text-sm text-muted italic font-serif">No positive style hits.</p>
              ) : (
                <ul className="space-y-2">
                  {hits.map((h, i) => (
                    <li
                      key={itemKey(h, "hit", i)}
                      className="nb-card p-3 text-sm"
                      style={{ borderColor: "#cde9da" }}
                    >
                      {h.rule && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-leaf mr-2">
                          [{h.rule}]
                        </span>
                      )}
                      <span className="text-ink-2">{h.message ?? h.text ?? JSON.stringify(h)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <hr className="nb-rule" />

            <section>
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-serif text-lg font-medium text-ink tracking-tight">
                  Fact-check
                </h3>
                {claims !== null && (
                  <span
                    className="nb-pill"
                    style={{
                      background: claims.some((c) => c.status !== "supported")
                        ? "#fdf6e6"
                        : "#e3f5ec",
                      color: claims.some((c) => c.status !== "supported") ? "#8a5d18" : "#1f7752",
                    }}
                  >
                    {claims.filter((c) => c.status !== "supported").length.toString().padStart(2, "0")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mb-3">
                Checks the draft's factual claims against your attached references.
              </p>
              {claimsError && (
                <p className="text-sm text-rose-ink mb-2">{claimsError}</p>
              )}
              {claims === null ? (
                <button
                  type="button"
                  onClick={runClaims}
                  disabled={claimsLoading}
                  className="nb-btn nb-btn-sm"
                >
                  {claimsLoading ? "Checking…" : "Check claims"}
                </button>
              ) : (
                <>
                  {!hasRefs && (
                    <p
                      className="text-xs px-3 py-2 rounded-nb-sm mb-2"
                      style={{ background: "#fdf6e6", color: "#8a5d18", border: "1px solid #f0d5a4" }}
                    >
                      No references attached — every claim is flagged as needing a source. Add
                      references to verify against them.
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
                  <button
                    type="button"
                    onClick={runClaims}
                    disabled={claimsLoading}
                    className="nb-btn nb-btn-ghost nb-btn-sm mt-2"
                  >
                    {claimsLoading ? "Checking…" : "Re-check"}
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </dialog>
    </div>
  );
}

const CLAIM_BORDER: Record<ClaimResult["status"], string> = {
  supported: "#cde9da",
  unsupported: "#f0d5a4",
  contradicted: "#f7c7cf",
};
const CLAIM_COLOR: Record<ClaimResult["status"], string> = {
  supported: "#1f7752",
  unsupported: "#8a5d18",
  contradicted: "#94293c",
};
