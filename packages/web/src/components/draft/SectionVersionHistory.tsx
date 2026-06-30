import { useCallback, useEffect, useState } from "react";

import { type SectionVersion, listSectionVersions } from "../../api/drafts";
import { type DiffPart, wordDiff } from "../../lib/wordDiff";

interface SectionVersionHistoryProps {
  draftId: string;
  sectionId: string;
  /** Bump to force a refetch (e.g. after a regenerate/save completes). */
  refreshKey?: number;
  /** Live content of the section, used as the "after" side of the version diff. */
  currentContent: string;
  onRevert: (versionId: string) => Promise<void>;
}

const SOURCE_LABEL: Record<SectionVersion["source"], string> = {
  regenerate: "Before regenerate",
  save: "Before manual edit",
  revert: "Before revert",
};

function formatRelative(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "moments ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function partClassName(type: DiffPart["type"]): string {
  switch (type) {
    case "add":
      return "bg-green-soft text-green-ink rounded-[3px]";
    case "del":
      return "bg-coral-soft text-coral-ink line-through rounded-[3px]";
    default:
      return "text-muted";
  }
}

/** Word-level before/after diff: green additions, struck-through coral deletions. */
function WordDiffView({ before, after }: { before: string; after: string }): JSX.Element {
  const parts = wordDiff(before, after);
  const hasChange = parts.some((p) => p.type !== "same");
  return (
    <div className="mt-2 rounded-nb-sm border border-rule bg-canvas/60 p-2.5">
      {!hasChange ? (
        <p className="text-[12px] text-muted italic">No differences from the current text.</p>
      ) : (
        <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words font-serif">
          {parts.map((part, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff parts are positional and stable for a given render
            <span key={idx} className={partClassName(part.type)}>
              {part.text}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function SectionVersionHistory({
  draftId,
  sectionId,
  refreshKey,
  currentContent,
  onRevert,
}: SectionVersionHistoryProps): JSX.Element {
  const [versions, setVersions] = useState<SectionVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [openDiffId, setOpenDiffId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setVersions(await listSectionVersions(draftId, sectionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draftId, sectionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a deliberate refetch trigger bumped by the parent when section content changes
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleRevert = async (versionId: string): Promise<void> => {
    setRevertingId(versionId);
    setError(null);
    try {
      await onRevert(versionId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <div className="mt-3 rounded-nb-sm border border-rule bg-canvas/60 p-3 animate-fade-in">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">
        Version history
      </p>

      {error && (
        <p
          className="text-xs px-3 py-2 rounded-nb-sm mb-2"
          style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
        >
          {error}
        </p>
      )}

      {versions === null ? (
        <p className="text-xs text-muted py-2">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-muted py-2 italic">
          No earlier versions yet. Saves and regenerations are snapshotted here.
        </p>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => {
            const diffOpen = openDiffId === v.id;
            return (
              <li
                key={v.id}
                className="rounded-nb-sm bg-card px-3 py-2 border border-rule"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-ink-2">{SOURCE_LABEL[v.source]}</span>
                      <span className="text-muted font-mono">· {formatRelative(v.created_at)}</span>
                      <span className="text-muted font-mono">· {v.word_count}w</span>
                    </div>
                    {!diffOpen && (
                      <p className="mt-1 text-[12px] text-muted line-clamp-2 whitespace-pre-wrap">
                        {v.content_md.slice(0, 220)}
                        {v.content_md.length > 220 ? "…" : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenDiffId(diffOpen ? null : v.id)}
                      aria-expanded={diffOpen}
                      className="nb-btn nb-btn-sm nb-btn-ghost"
                    >
                      {diffOpen ? "Hide diff" : "View diff"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevert(v.id)}
                      disabled={revertingId !== null}
                      className="nb-btn nb-btn-sm"
                    >
                      {revertingId === v.id ? "Reverting…" : "Revert"}
                    </button>
                  </div>
                </div>
                {diffOpen && (
                  <>
                    <div className="mt-2 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wider text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-[2px] bg-green" />
                        Added
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-[2px] bg-coral" />
                        Removed
                      </span>
                      <span className="text-muted/80 normal-case tracking-normal">
                        (this version → current)
                      </span>
                    </div>
                    <WordDiffView before={v.content_md} after={currentContent} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
