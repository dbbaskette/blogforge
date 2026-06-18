import { useState } from "react";

import { downloadDraftUrl } from "../../api/drafts";

interface WorkspaceFooterProps {
  draftId: string;
  totalWords: number;
  draftedCount: number;
  sectionCount: number;
  onLint: () => void;
  onRepurpose: () => void;
}

export function WorkspaceFooter({
  draftId,
  totalWords,
  draftedCount,
  sectionCount,
  onLint,
  onRepurpose,
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
        <DownloadMenu draftId={draftId} />
        <button type="button" onClick={onRepurpose} className="nb-btn nb-btn-sm">
          Repurpose
        </button>
        <button type="button" onClick={onLint} className="nb-btn nb-btn-primary nb-btn-sm">
          Review
        </button>
      </footer>
    </div>
  );
}

const DOWNLOAD_OPTIONS: { label: string; opts: Parameters<typeof downloadDraftUrl>[1] }[] = [
  { label: "Markdown (.md)", opts: { format: "md" } },
  { label: "Markdown + frontmatter", opts: { format: "md", frontmatter: true } },
  { label: "Web page (.html)", opts: { format: "html" } },
  { label: "Word (.docx)", opts: { format: "docx" } },
];

function DownloadMenu({ draftId }: { draftId: string }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {open && (
        <>
          {/* click-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-0 cursor-default"
          />
          <div className="absolute bottom-full right-0 mb-2 z-10 w-52 nb-card shadow-nb-pop py-1.5 animate-fade-in">
            {DOWNLOAD_OPTIONS.map((o) => (
              <a
                key={o.label}
                href={downloadDraftUrl(draftId, o.opts)}
                download
                onClick={() => setOpen(false)}
                className="block px-4 py-1.5 text-sm text-ink hover:bg-card-2 no-underline"
              >
                {o.label}
              </a>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="nb-btn nb-btn-sm"
      >
        Download ▾
      </button>
    </div>
  );
}
