import { useRef, useState } from "react";

import { stripEmbeddedImages } from "../../lib/markdownImages";
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
const RAW_FILE_MAX_BYTES = 25_000_000;
const CLEAN_TEXT_MAX_CHARS = 200_000;

function exceedsCodePointLimit(text: string, limit: number): boolean {
  let count = 0;
  for (const _character of text) {
    count += 1;
    if (count > limit) return true;
  }
  return false;
}

function formatRemovedSize(characters: number): string {
  if (characters >= 1_000_000) return `${(characters / 1_000_000).toFixed(1)} MB`;
  if (characters >= 1_000) return `${Math.round(characters / 1_000)} KB`;
  return `${characters} characters`;
}

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
    if (file.size > RAW_FILE_MAX_BYTES) {
      setNote("That file is too large to import.");
      return;
    }
    const raw = await file.text();
    const cleaned = stripEmbeddedImages(raw);
    if (exceedsCodePointLimit(cleaned.text, CLEAN_TEXT_MAX_CHARS)) {
      setNote(
        cleaned.removedImages > 0
          ? "The article text remains too long after embedded images were removed."
          : "That file is too long to import.",
      );
      return;
    }
    onText(normalizeMarkdown(cleaned.text));
    setNote(
      cleaned.removedImages > 0
        ? `Loaded ${file.name}; removed ${cleaned.removedImages} embedded image${
            cleaned.removedImages === 1 ? "" : "s"
          } (${formatRemovedSize(cleaned.removedCharacters)}).`
        : `Loaded ${file.name}`,
    );
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
        {busy ? "Importing…" : "Import →"}
      </button>
    </>
  );
}
