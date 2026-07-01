import { useRef, useState } from "react";

import { needsNormalizing, normalizeMarkdown } from "../../lib/markdownNormalize";

/** Count the sections a paste will split into: one per H2 heading, or a single
 * section when there are none (matching the backend's ingest_document). */
export function countSections(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const h2s = trimmed.match(/^##[ \t]+\S/gm);
  return h2s ? h2s.length : 1;
}

const ACCEPT = ".md,.markdown,.mdown,.txt,.text,text/markdown,text/plain";
const MAX_BYTES = 1_000_000; // 1 MB — a very long post; guards against a stray big file

export function PastePanel({
  text,
  onText,
  onRun,
  busy,
  disabled = false,
}: {
  text: string;
  onText: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  disabled?: boolean;
}): JSX.Element {
  const sections = countSections(text);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function loadFile(file: File): Promise<void> {
    if (file.size > MAX_BYTES) {
      setNote("That file is too large to import.");
      return;
    }
    const raw = await file.text();
    onText(normalizeMarkdown(raw));
    setNote(`Loaded ${file.name}`);
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  // Clean up word-processor artifacts (• bullets, NBSP, "1)") on paste so the
  // formatting survives — only when the pasted text actually needs it, so a
  // normal markdown paste is left exactly as-is.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = e.clipboardData.getData("text");
    if (!needsNormalizing(pasted)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const clean = normalizeMarkdown(pasted);
    const next = text.slice(0, start) + clean + text.slice(end);
    onText(next);
    setNote("Cleaned up pasted formatting into Markdown.");
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="paste-text" className="nb-label">
            Paste your draft
          </label>
          <button
            type="button"
            className="text-xs text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2"
            onClick={() => fileRef.current?.click()}
          >
            Import a .md file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) loadFile(file);
              e.target.value = "";
            }}
          />
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={dragging ? "rounded-nb-sm ring-2 ring-cobalt-400" : ""}
        >
          <textarea
            id="paste-text"
            aria-label="Paste your draft"
            className="nb-input w-full min-h-[14rem] resize-y text-sm"
            placeholder={
              "Paste your finished post — or drop a .md file here. Use ## headings to split it into sections; - or * for bullets."
            }
            value={text}
            onChange={(e) => onText(e.target.value)}
            onPaste={onPaste}
          />
        </div>
      </div>

      <p className="text-sm text-muted">
        {sections === 0 ? (
          "Paste text or drop a .md file to import."
        ) : (
          <>
            Will import as{" "}
            <span className="font-medium text-ink">
              {sections} section{sections !== 1 ? "s" : ""}
            </span>{" "}
            — then you can fact-check, reword, and expand it in the editor.
          </>
        )}
        {note && <span className="text-cobalt-600"> · {note}</span>}
      </p>

      <button
        type="button"
        className="nb-btn nb-btn-primary"
        onClick={onRun}
        disabled={busy || disabled || sections === 0}
      >
        {busy ? "Importing…" : "Import & shape →"}
      </button>
    </>
  );
}
