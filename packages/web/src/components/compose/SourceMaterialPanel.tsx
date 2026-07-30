export function SourceMaterialPanel({
  title,
  onTitle,
  sourceText,
  onSourceText,
  onRun,
  busy,
  disabled = false,
}: {
  title: string;
  onTitle: (value: string) => void;
  sourceText: string;
  onSourceText: (value: string) => void;
  onRun: () => void;
  busy: boolean;
  disabled?: boolean;
}): JSX.Element {
  const cannotRun = busy || disabled || !title.trim() || !sourceText.trim();

  return (
    <>
      <div>
        <label htmlFor="source-material-title" className="nb-label">
          Blog title
        </label>
        <input
          id="source-material-title"
          type="text"
          className="nb-input w-full"
          value={title}
          onChange={(event) => onTitle(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="source-material-text" className="nb-label">
          Source material
        </label>
        <textarea
          id="source-material-text"
          className="nb-input w-full min-h-[14rem] resize-y text-sm"
          placeholder="Paste a Markdown brief, notes, or research here."
          value={sourceText}
          onChange={(event) => onSourceText(event.target.value)}
        />
      </div>

      <p className="text-sm text-muted">
        BlogForge uses this to build a new blog outline. It doesn't copy its headings.
      </p>

      <button type="button" className="nb-btn nb-btn-primary" onClick={onRun} disabled={cannotRun}>
        {busy ? "Building outline…" : "Build outline →"}
      </button>
    </>
  );
}
