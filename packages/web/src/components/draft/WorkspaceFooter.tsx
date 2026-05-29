import { useState } from "react";

import { downloadDraftUrl } from "../../api/drafts";

interface WorkspaceFooterProps {
  draftId: string;
  totalWords: number;
  draftedCount: number;
  sectionCount: number;
  onLint: () => void;
}

export function WorkspaceFooter({
  draftId,
  totalWords,
  draftedCount,
  sectionCount,
  onLint,
}: WorkspaceFooterProps): JSX.Element {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const handleCopy = async (): Promise<void> => {
    try {
      const res = await fetch(downloadDraftUrl(draftId), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      await navigator.clipboard.writeText(md);
      setCopyMessage("Copied!");
    } catch {
      setCopyMessage("Copy failed");
    }
    setTimeout(() => setCopyMessage(null), 2000);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full max-w-3xl px-4">
      <footer className="nb-card shadow-nb-pop px-4 py-2.5 flex items-center gap-4 pointer-events-auto">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="font-mono text-ink font-medium text-[13px]">
            {totalWords.toLocaleString()}
          </span>
          <span>words</span>
          <span className="text-muted-2">·</span>
          <span>
            <span className="font-mono text-ink">
              {draftedCount}/{sectionCount}
            </span>{" "}
            drafted
          </span>
        </div>
        <div className="flex-1" />

        <button type="button" onClick={handleCopy} className="nb-btn nb-btn-sm">
          {copyMessage ?? "Copy markdown"}
        </button>
        <a href={downloadDraftUrl(draftId)} download className="nb-btn nb-btn-sm no-underline">
          Download .md
        </a>
        <button type="button" onClick={onLint} className="nb-btn nb-btn-sm">
          Lint
        </button>
      </footer>
    </div>
  );
}
