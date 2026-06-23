export function BlankPanel({
  topic,
  onTopic,
  onRun,
  busy,
  disabled = false,
}: {
  topic: string;
  onTopic: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  disabled?: boolean;
}): JSX.Element {
  return (
    <>
      <div>
        <label htmlFor="compose-title" className="nb-label">
          Title
        </label>
        <input
          id="compose-title"
          type="text"
          className="nb-input w-full"
          placeholder="Name your post (you can rename later)"
          value={topic}
          onChange={(e) => onTopic(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="nb-btn nb-btn-primary"
        onClick={onRun}
        disabled={busy || disabled}
      >
        {busy ? "Opening…" : "Open editor"}
      </button>
    </>
  );
}
