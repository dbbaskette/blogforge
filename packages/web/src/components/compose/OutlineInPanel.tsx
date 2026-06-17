import { parseOutline } from "../../lib/parseOutline";

export function OutlineInPanel({
  outlineText,
  onOutlineText,
  onRun,
  busy,
}: {
  outlineText: string;
  onOutlineText: (v: string) => void;
  onRun: () => void;
  busy: boolean;
}): JSX.Element {
  const parsed = parseOutline(outlineText);
  const sectionCount = parsed.sections.length;

  return (
    <>
      <div>
        <label htmlFor="outline-text" className="nb-label">
          Your outline
        </label>
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
            <p className="font-medium text-ink">Parsed · {sectionCount} section{sectionCount !== 1 ? "s" : ""}</p>
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
        disabled={busy || sectionCount === 0}
      >
        {busy ? "Writing draft…" : "Write draft →"}
      </button>
    </>
  );
}
