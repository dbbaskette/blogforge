import { useState } from "react";

import { type Issue, type IssueAction, isInputAction } from "../../lib/issues/types";

const ACTION_LABEL: Record<IssueAction, string> = {
  ai_fix: "AI fix",
  manual_fix: "Manual fix",
  highlight: "Highlight",
  generate: "Generate",
  write_own: "Write my own",
  cite_source: "Cite source",
  quote_source: "Quote",
  add_fact: "Add a fact",
  add_date: "Add a date",
  dedupe: "Remove duplicate",
  dismiss: "Dismiss",
};

const INPUT_PLACEHOLDER: Partial<Record<IssueAction, string>> = {
  manual_fix: "Edit the passage…",
  write_own: "Write it yourself…",
  add_fact: "A real stat or source to weave in…",
  add_date: "A real date or year to cite…",
  cite_source: "Paste a URL or name the source to cite…",
};

interface IssueCardProps {
  issue: Issue;
  busy?: boolean;
  onAction: (action: IssueAction, input?: string) => void;
  onAccept: () => void;
  onUndo: () => void;
  /** Per-panel action-label overrides (e.g. Humanize renames "Highlight" to
   * "Jump to" since its heat-map already highlights every finding). */
  actionLabels?: Partial<Record<IssueAction, string>>;
}

/**
 * The one card every review issue renders through. Pure presentation: it shows
 * the issue in its open / review / accepted state with an adaptive action row,
 * and reports intent through callbacks. All apply/accept/undo logic lives in
 * useIssueLifecycle.
 */
export function IssueCard({
  issue,
  busy,
  onAction,
  onAccept,
  onUndo,
  actionLabels,
}: IssueCardProps): JSX.Element {
  const [openInput, setOpenInput] = useState<IssueAction | null>(null);
  const [text, setText] = useState("");

  const isAdvisory = issue.nature === "advisory";
  const border =
    issue.status === "review"
      ? "border-amber"
      : issue.status === "accepted"
        ? "border-green"
        : isAdvisory
          ? "border-rule-2"
          : "border-coral";
  const dot = issue.status === "review" ? "bg-amber" : isAdvisory ? "bg-muted" : "bg-coral";
  const statusLabel = issue.status === "review" ? "Review" : isAdvisory ? "Advisory" : "Open";
  const statusColor =
    issue.status === "review" ? "text-amber-ink" : isAdvisory ? "text-muted" : "text-coral-ink";

  if (issue.status === "accepted") {
    return (
      <div className={`bg-card border ${border} rounded-nb px-3 py-2 flex items-center gap-2`}>
        <span aria-hidden className="text-green-ink">
          ✓
        </span>
        <span className="text-xs font-medium text-green-ink">Accepted</span>
        <span className="text-sm text-ink-2 truncate">{issue.title}</span>
        <button
          type="button"
          className="nb-btn nb-btn-ghost nb-btn-sm ml-auto shrink-0"
          onClick={onUndo}
          disabled={busy}
        >
          Undo
        </button>
      </div>
    );
  }

  if (issue.status === "review") {
    return (
      <div className={`bg-card border ${border} rounded-nb px-4 py-3`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
          <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
          <span className="text-sm font-medium text-ink">{issue.title}</span>
        </div>
        <p className="text-[13px] text-ink-2 leading-snug ml-4 mb-2.5">
          Applied. The change is highlighted in your draft — read it, then accept or undo.
        </p>
        <div className="flex gap-2 ml-4">
          <button
            type="button"
            className="nb-btn nb-btn-sm bg-green-soft text-green-ink border-green/40"
            onClick={onAccept}
            disabled={busy}
          >
            Accept
          </button>
          <button
            type="button"
            className="nb-btn nb-btn-ghost nb-btn-sm"
            onClick={onUndo}
            disabled={busy}
          >
            Undo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card border ${border} rounded-nb px-4 py-3`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
        <span className="text-sm font-medium text-ink">{issue.title}</span>
      </div>
      <p className="text-[13px] text-ink-2 leading-snug ml-4 mb-1.5">{issue.why}</p>
      {issue.target && (
        <p className="text-[13px] text-muted italic leading-snug ml-4 mb-2.5 line-clamp-2">
          “{issue.target}”
        </p>
      )}

      {openInput ? (
        <div className="ml-4">
          <textarea
            className="nb-input w-full text-sm min-h-[72px]"
            placeholder={INPUT_PLACEHOLDER[openInput] ?? "…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="nb-btn nb-btn-sm bg-cobalt-50 text-cobalt-800 border-cobalt-200"
              onClick={() => {
                onAction(openInput, text.trim());
                setOpenInput(null);
                setText("");
              }}
              disabled={busy || text.trim().length === 0}
            >
              Apply
            </button>
            <button
              type="button"
              className="nb-btn nb-btn-ghost nb-btn-sm"
              onClick={() => {
                setOpenInput(null);
                setText("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 ml-4">
          {issue.actions.map((action) => (
            <button
              key={action}
              type="button"
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
              onClick={() => (isInputAction(action) ? setOpenInput(action) : onAction(action))}
            >
              {actionLabels?.[action] ?? ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
