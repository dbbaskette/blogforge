/** Count the sections a paste will split into: one per H2 heading, or a single
 * section when there are none (matching the backend's ingest_document). */
export function countSections(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const h2s = trimmed.match(/^##[ \t]+\S/gm);
  return h2s ? h2s.length : 1;
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
  return (
    <>
      <div>
        <label htmlFor="paste-text" className="nb-label">
          Paste your draft
        </label>
        <textarea
          id="paste-text"
          aria-label="Paste your draft"
          className="nb-input w-full min-h-[14rem] resize-y text-sm"
          placeholder={
            "Paste your finished post here. Use ## headings to split it into sections — or don't, and we'll keep it as one."
          }
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
      </div>

      <p className="text-sm text-muted">
        {sections === 0 ? (
          "Paste some text to import."
        ) : (
          <>
            Will import as{" "}
            <span className="font-medium text-ink">
              {sections} section{sections !== 1 ? "s" : ""}
            </span>{" "}
            — then you can fact-check, reword, and expand it in the editor.
          </>
        )}
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
