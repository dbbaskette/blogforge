export function BlankPanel({
  topic,
  onTopic,
  onRun,
  busy,
}: {
  topic: string;
  onTopic: (v: string) => void;
  onRun: () => void;
  busy: boolean;
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
          placeholder="What are you writing about?"
          value={topic}
          onChange={(e) => onTopic(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="nb-btn nb-btn-primary"
        onClick={onRun}
        disabled={busy}
      >
        {busy ? "Opening…" : "Open editor"}
      </button>
    </>
  );
}
