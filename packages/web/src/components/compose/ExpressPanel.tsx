export function ExpressPanel({
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
        <label htmlFor="express-topic" className="nb-label">
          Topic
        </label>
        <input
          id="express-topic"
          type="text"
          aria-label="Topic"
          className="nb-input w-full"
          placeholder="What is this post about?"
          value={topic}
          onChange={(e) => onTopic(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="nb-btn nb-btn-primary"
        onClick={onRun}
        disabled={busy || disabled || !topic.trim()}
      >
        {busy ? "Outlining → writing…" : "Outline & write →"}
      </button>
    </>
  );
}
