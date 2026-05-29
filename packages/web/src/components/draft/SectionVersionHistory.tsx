import { useCallback, useEffect, useState } from "react";

import { type SectionVersion, listSectionVersions } from "../../api/drafts";

interface SectionVersionHistoryProps {
  draftId: string;
  sectionId: string;
  /** Bump to force a refetch (e.g. after a regenerate/save completes). */
  refreshKey?: number;
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

export function SectionVersionHistory({
  draftId,
  sectionId,
  refreshKey,
  onRevert,
}: SectionVersionHistoryProps): JSX.Element {
  const [versions, setVersions] = useState<SectionVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);

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
          style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
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
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-start justify-between gap-3 rounded-nb-sm bg-card px-3 py-2 border border-rule"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-ink-2">{SOURCE_LABEL[v.source]}</span>
                  <span className="text-muted font-mono">· {formatRelative(v.created_at)}</span>
                  <span className="text-muted font-mono">· {v.word_count}w</span>
                </div>
                <p className="mt-1 text-[12px] text-muted line-clamp-2 whitespace-pre-wrap">
                  {v.content_md.slice(0, 220)}
                  {v.content_md.length > 220 ? "…" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRevert(v.id)}
                disabled={revertingId !== null}
                className="nb-btn nb-btn-sm shrink-0"
              >
                {revertingId === v.id ? "Reverting…" : "Revert"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
