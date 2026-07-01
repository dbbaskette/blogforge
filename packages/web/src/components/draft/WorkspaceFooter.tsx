import { useState } from "react";

import { type Draft, downloadDraftUrl } from "../../api/drafts";
import { ReadingPreview } from "./ReadingPreview";

interface WorkspaceFooterProps {
  /** Full draft — powers the publish-ready reading preview rendered from here. */
  draft: Draft;
  totalWords: number;
  draftedCount: number;
  sectionCount: number;
  onLint: () => void;
  onRepurpose: () => void;
  onHeadlines: () => void;
  onShape: () => void;
  onGeo: () => void;
  /**
   * Optional hook fired when the reading preview opens. The footer owns the
   * preview's open/close state locally (DraftWorkspace can't host it), so this
   * is purely a notification for the parent and is not required.
   */
  onPreview?: () => void;
}

export function WorkspaceFooter({
  draft,
  totalWords,
  draftedCount,
  sectionCount,
  onLint,
  onRepurpose,
  onHeadlines,
  onShape,
  onGeo,
  onPreview,
}: WorkspaceFooterProps): JSX.Element {
  const draftId = draft.id;
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const openPreview = (): void => {
    setPreviewOpen(true);
    onPreview?.();
  };

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
      <footer
        className="nb-card shadow-nb-pop px-4 py-2.5 flex items-center gap-4 flex-wrap pointer-events-auto"
        aria-label="Draft tools"
      >
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

        <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-wider text-muted-2 mr-1">
          Tools
        </span>
        <button
          type="button"
          onClick={onHeadlines}
          className="nb-btn nb-btn-sm"
          title="Generate alternative titles and opening hooks"
        >
          Headlines
        </button>
        <button
          type="button"
          onClick={onRepurpose}
          className="nb-btn nb-btn-sm"
          title="Turn this draft into social posts, a newsletter, and more"
        >
          Repurpose
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="nb-btn nb-btn-sm"
          title="Copy the whole draft as Markdown"
        >
          {copyMessage ?? "Copy markdown"}
        </button>
        <DownloadMenu draftId={draftId} />
        <button
          type="button"
          onClick={openPreview}
          className="nb-btn nb-btn-sm"
          title="See the finished post as a typeset, publish-ready article"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onShape}
          className="nb-btn nb-btn-sm"
          title="Get suggestions: claims worth verifying, sharper wordings, and where to expand"
        >
          Shape
        </button>
        <button
          type="button"
          onClick={onGeo}
          className="nb-btn nb-btn-sm"
          title="Score & optimize for AI answer engines (GEO): answer-first, factual density, question headings, FAQ"
        >
          GEO
        </button>
        <button
          type="button"
          onClick={onLint}
          className="nb-btn nb-btn-primary nb-btn-sm"
          title="Proofread and fact-check the draft"
        >
          Review
        </button>
      </footer>
      {previewOpen && <ReadingPreview draft={draft} onClose={() => setPreviewOpen(false)} />}
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
  const [error, setError] = useState<string | null>(null);

  // Fetch → blob instead of a bare <a href>: a failed export (expired session,
  // server hiccup) used to silently save the JSON error body as
  // "download.json". Now failures surface as a message and save nothing.
  const download = async (opts: Parameters<typeof downloadDraftUrl>[1]): Promise<void> => {
    setError(null);
    setOpen(false);
    try {
      const res = await fetch(downloadDraftUrl(draftId, opts), { credentials: "include" });
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Session expired — sign in again, then retry."
            : `Export failed (HTTP ${res.status}).`,
        );
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `post.${opts?.format ?? "md"}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setError(null), 5000);
    }
  };

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
              <button
                key={o.label}
                type="button"
                onClick={() => download(o.opts)}
                className="block w-full text-left px-4 py-1.5 text-sm text-ink hover:bg-card-2"
              >
                {o.label}
              </button>
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
        {error ?? "Download ▾"}
      </button>
    </div>
  );
}
