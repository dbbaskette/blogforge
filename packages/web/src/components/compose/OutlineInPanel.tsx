import { parseOutline } from "../../lib/parseOutline";

export function OutlineInPanel({
  outlineText,
  onOutlineText,
  onRun,
  busy,
  disabled = false,
}: {
  outlineText: string;
  onOutlineText: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  disabled?: boolean;
}): JSX.Element {
  const parsed = parseOutline(outlineText);
  const sectionCount = parsed.sections.length;

  const EXAMPLE =
    "# Your post title\n" +
    "## Set up the problem\n" +
    "## The key idea\n" +
    "## How it works in practice\n" +
    "## What to watch out for\n" +
    "## Conclusion";

  return (
    <>
      <div>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="outline-text" className="nb-label">
            Your outline
          </label>
          {outlineText.trim() === "" && (
            <button
              type="button"
              className="text-xs text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2"
              onClick={() => onOutlineText(EXAMPLE)}
            >
              Insert example structure
            </button>
          )}
        </div>
        <textarea
          id="outline-text"
          aria-label="Your outline"
          className="nb-input w-full min-h-[10rem] resize-y font-mono text-sm"
          placeholder={"# Post title\n## Section one\n## Section two\n## Conclusion"}
          value={outlineText}
          onChange={(e) => onOutlineText(e.target.value)}
        />
      </div>

      {/* Live parsed-section preview */}
      <div className="text-sm text-muted space-y-1">
        {sectionCount === 0 ? (
          <p>Add a heading or bullet to see parsed sections.</p>
        ) : (
          <>
            <p className="font-medium text-ink">
              Parsed · {sectionCount} section{sectionCount !== 1 ? "s" : ""}
            </p>
            <ul className="list-disc list-inside space-y-0.5">
              {parsed.sections.map((s, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: sections have no stable id here
                <li key={i}>{s.title}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <button
        type="button"
        className="nb-btn nb-btn-primary"
        onClick={onRun}
        disabled={busy || disabled || sectionCount === 0}
      >
        {busy ? "Writing draft…" : "Write draft →"}
      </button>
    </>
  );
}
