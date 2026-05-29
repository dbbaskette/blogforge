import { useState } from "react";

import type { Section } from "../../api/drafts";
import { Icon } from "../ui/Icon";
import { MarkdownEditor } from "./MarkdownEditor";

interface SectionCardProps {
  section: Section;
  index: number;
  isGenerating: boolean;
  /** Live streaming prose for this section (single-section regenerate). */
  liveText?: string;
  defaultOpen?: boolean;
  onSave: (content_md: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function StatusPill({ status }: { status: Section["status"] }): JSX.Element {
  switch (status) {
    case "ready":
      return (
        <span className="nb-pill nb-pill-ready">
          <span className="dot" />
          Ready
        </span>
      );
    case "edited":
      return (
        <span className="nb-pill nb-pill-edited">
          <span className="dot" />
          Edited
        </span>
      );
    case "generating":
      return (
        <span className="nb-pill nb-pill-gen">
          <span className="dot animate-pulse" />
          Composing
        </span>
      );
    case "failed":
      return (
        <span className="nb-pill nb-pill-failed">
          <span className="dot" />
          Failed
        </span>
      );
    default:
      return (
        <span className="nb-pill nb-pill-empty">
          <span className="dot" />
          Unwritten
        </span>
      );
  }
}

export function SectionCard({
  section,
  index,
  isGenerating,
  liveText,
  defaultOpen,
  onSave,
  onRegenerate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: SectionCardProps): JSX.Element {
  const hasLiveText = liveText !== undefined && liveText.length > 0;
  const effectiveGenerating = isGenerating || section.status === "generating";
  const displayStatus: Section["status"] = effectiveGenerating ? "generating" : section.status;

  const initialOpen =
    defaultOpen !== undefined
      ? defaultOpen
      : displayStatus === "ready" ||
        displayStatus === "edited" ||
        displayStatus === "failed" ||
        displayStatus === "generating";

  const [open, setOpen] = useState(initialOpen);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const handleRegenerate = async (): Promise<void> => {
    setRegenerating(true);
    setRegenError(null);
    try {
      await onRegenerate();
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  const isFailed = displayStatus === "failed";

  return (
    <article
      id={`section-${section.id}`}
      className={`nb-card scroll-mt-20 ${isFailed ? "" : "nb-card-hover"}`}
      style={isFailed ? { borderColor: "#f7c7cf" } : undefined}
    >
      {/* Toggle row — heading is a button, side controls live outside it. */}
      <div className="grid grid-cols-[1fr_auto] items-stretch">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid grid-cols-[44px_1fr] gap-4 items-center p-5 text-left hover:bg-card-2 transition-colors rounded-l-nb"
          aria-expanded={open}
          aria-controls={`section-body-${section.id}`}
        >
          <span
            className={`w-9 h-9 rounded-nb-sm grid place-items-center font-mono text-xs font-semibold transition-colors ${
              open ? "bg-cobalt-50 text-cobalt-700" : "bg-canvas text-muted"
            }`}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h3 className="font-serif text-xl font-medium text-ink leading-snug tracking-tight">
              {section.title}
            </h3>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
              <StatusPill status={displayStatus} />
              {section.word_count > 0 && (
                <span className="text-muted font-mono">{section.word_count} words</span>
              )}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 pr-5">
          {canMoveUp && (
            <button
              type="button"
              onClick={onMoveUp}
              className="nb-icon-btn"
              aria-label="Move section up"
            >
              <Icon name="chevron-up" size={14} title="" />
            </button>
          )}
          {canMoveDown && (
            <button
              type="button"
              onClick={onMoveDown}
              className="nb-icon-btn"
              aria-label="Move section down"
            >
              <Icon name="chevron-down" size={14} title="" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="nb-icon-btn"
            aria-label={open ? "Collapse section" : "Expand section"}
          >
            <Icon
              name="chevron-down"
              size={16}
              title=""
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {open && (
        <div
          id={`section-body-${section.id}`}
          className="px-5 pb-5 pt-1 border-t border-rule animate-fade-in"
        >
          {section.brief && (
            <p className="font-serif italic text-[14px] text-muted px-3 py-2 mt-3 mb-4 rounded-nb-sm bg-cobalt-50/60 border-l-[3px] border-cobalt-200">
              {section.brief}
            </p>
          )}

          {isFailed && section.last_error && (
            <div
              className="mb-4 px-3 py-2.5 rounded-nb-sm text-sm leading-snug"
              style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5">
                Last attempt failed
              </p>
              {section.last_error}
            </div>
          )}

          {hasLiveText ? (
            <div className="mt-3" aria-live="polite" aria-busy="true">
              <div className="flex items-center gap-2 text-amber mb-2">
                <span
                  aria-hidden
                  className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
                />
                <span className="text-xs font-medium uppercase tracking-wider">Composing…</span>
              </div>
              <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink-2">
                {liveText}
                <span className="inline-block w-1.5 h-4 -mb-0.5 ml-0.5 bg-amber animate-pulse align-middle" />
              </p>
            </div>
          ) : effectiveGenerating ? (
            <div className="flex items-center gap-3 py-10 justify-center text-amber">
              <span
                aria-hidden
                className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              />
              <span className="text-sm font-medium">Composing this section…</span>
            </div>
          ) : section.content_md.trim() ? (
            <MarkdownEditor initialMarkdown={section.content_md} onSave={onSave} />
          ) : (
            <div
              className="nb-card p-6 text-center border-dashed"
              style={{ background: "#fafbfc" }}
            >
              <p className="text-sm text-muted mb-3">This section hasn't been composed yet.</p>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                {regenerating ? "Composing…" : "Compose this section →"}
              </button>
            </div>
          )}

          {regenError && (
            <p
              className="mt-3 text-xs px-3 py-2 rounded-nb-sm"
              style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
            >
              {regenError}
            </p>
          )}

          {section.content_md.trim() && !effectiveGenerating && (
            <div className="mt-4 pt-4 border-t border-rule flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating || effectiveGenerating}
                className="nb-btn nb-btn-sm"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
