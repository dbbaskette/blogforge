import type { ComposeSettings } from "../../lib/composeDefaults";

/**
 * Always-visible one-liner that surfaces the (mostly auto-selected) generation
 * setup — voice, model, length — so the writer can see everything's ready
 * without opening Advanced, plus a one-click Edit to jump into it. Replaces the
 * bare "Writing with X · Y" line and makes the silent auto-picks visible.
 */
export function SetupSummary({
  settings,
  providerLabel,
  onEdit,
}: {
  settings: ComposeSettings;
  providerLabel: string;
  onEdit: () => void;
}): JSX.Element {
  const voice = settings.use_voice_profile ? "your voice" : settings.pack_slug || "a pack";
  return (
    <p className="text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        ✍ Writing in <b className="text-ink">{voice}</b>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {providerLabel} <span className="font-mono text-xs text-ink-2">{settings.model}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span>~{settings.target_words.toLocaleString()} words</span>
      <button
        type="button"
        onClick={onEdit}
        className="text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2"
      >
        Edit
      </button>
    </p>
  );
}
