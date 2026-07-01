import { useState } from "react";

import { type Draft, downloadDraftUrl } from "../../api/drafts";
import { PublishDialog } from "./PublishDialog";
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
  onCheckup: () => void;
  /**
   * Optional hook fired when the reading preview opens. The footer owns the
   * preview's open/close state locally (DraftWorkspace can't host it), so this
   * is purely a notification for the parent and is not required.
   */
  onPreview?: () => void;
}

interface MenuItem {
  label: string;
  hint?: string;
  onClick: () => void | Promise<void>;
}

/** Upward-opening popup menu shared by the footer's grouped tools. `status`
 * (e.g. "Copied!", an export error) temporarily replaces the trigger label. */
function FooterMenu({
  label,
  status,
  items,
}: {
  label: string;
  status?: string | null;
  items: MenuItem[];
}): JSX.Element {
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
          <div className="absolute bottom-full right-0 mb-2 z-10 w-56 nb-card shadow-nb-pop py-1.5 animate-fade-in">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className="block w-full text-left px-4 py-1.5 text-sm text-ink hover:bg-card-2"
              >
                {item.label}
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
        {status ?? `${label} ▾`}
      </button>
    </div>
  );
}

const DOWNLOAD_OPTIONS: { label: string; opts: Parameters<typeof downloadDraftUrl>[1] }[] = [
  { label: "Markdown (.md)", opts: { format: "md" } },
  { label: "Markdown + frontmatter", opts: { format: "md", frontmatter: true } },
  { label: "Web page (.html)", opts: { format: "html" } },
  { label: "Word (.docx)", opts: { format: "docx" } },
];

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
  onCheckup,
  onPreview,
}: WorkspaceFooterProps): JSX.Element {
  const draftId = draft.id;
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const openPreview = (): void => {
    setPreviewOpen(true);
    onPreview?.();
  };

  const flashStatus = (msg: string): void => {
    setExportStatus(msg);
    setTimeout(() => setExportStatus(null), 4000);
  };

  const handleCopy = async (): Promise<void> => {
    try {
      const res = await fetch(downloadDraftUrl(draftId), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      await navigator.clipboard.writeText(md);
      flashStatus("Copied!");
    } catch {
      flashStatus("Copy failed");
    }
  };

  // Fetch → blob instead of a bare <a href>: a failed export (expired session,
  // server hiccup) used to silently save the JSON error body as
  // "download.json". Now failures surface as a message and save nothing.
  const download = async (opts: Parameters<typeof downloadDraftUrl>[1]): Promise<void> => {
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
      flashStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const improveItems: MenuItem[] = [
    {
      label: "🔎 Proofread & fact-check",
      hint: "Voice-rule violations, repetition, and AI-tells",
      onClick: onLint,
    },
    {
      label: "✨ Shape assistant",
      hint: "Claims worth verifying, sharper wordings, and where to expand",
      onClick: onShape,
    },
    {
      label: "🌐 GEO optimizer",
      hint: "Score & optimize for AI answer engines",
      onClick: onGeo,
    },
    {
      label: "✒️ Headlines & hooks",
      hint: "Generate alternative titles and opening hooks",
      onClick: onHeadlines,
    },
  ];

  const exportItems: MenuItem[] = [
    {
      label: "🐙 Publish to GitHub…",
      hint: "Open your blog repo's new-file editor with this post ready to commit",
      onClick: () => setPublishOpen(true),
    },
    { label: "Copy markdown", hint: "Copy the whole draft as Markdown", onClick: handleCopy },
    ...DOWNLOAD_OPTIONS.map((o) => ({ label: o.label, onClick: () => download(o.opts) })),
    {
      label: "Repurpose…",
      hint: "Turn this draft into social posts, a newsletter, and more",
      onClick: onRepurpose,
    },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full max-w-3xl px-4">
      <footer
        className="nb-card shadow-nb-pop px-4 py-2.5 flex items-center gap-3 flex-wrap pointer-events-auto"
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

        <FooterMenu label="✨ Improve" items={improveItems} />
        <FooterMenu label="Export" status={exportStatus} items={exportItems} />
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
          onClick={onCheckup}
          className="nb-btn nb-btn-primary nb-btn-sm"
          title="Run Review + GEO + Shape together and see a prioritized summary"
        >
          ✨ Checkup
        </button>
      </footer>
      {previewOpen && <ReadingPreview draft={draft} onClose={() => setPreviewOpen(false)} />}
      {publishOpen && <PublishDialog draft={draft} onClose={() => setPublishOpen(false)} />}
    </div>
  );
}
