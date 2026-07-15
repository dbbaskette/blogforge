import { useState } from "react";

import type { Draft, IdeaInput } from "../../api/drafts";
import { type ComposeSettings, SetupFields } from "../SetupFields";
import { Icon } from "../ui/Icon";

interface SetupDisclosureProps {
  draft: Draft;
  onChange: (idea: IdeaInput) => void;
  forceOpen?: boolean;
}

export function SetupDisclosure({
  draft,
  onChange,
  forceOpen = false,
}: SetupDisclosureProps): JSX.Element {
  const idea = draft.idea;
  // Default use_voice_profile to true when undefined (legacy drafts).
  const useVoiceProfile = idea.use_voice_profile ?? true;
  const [open, setOpen] = useState(forceOpen);

  const voiceLabel = useVoiceProfile ? "voice: my profile" : `pack ${idea.pack_slug || "—"}`;

  const summary = `${voiceLabel} · ${idea.format || "no format"} · ${
    idea.provider
  }/${idea.model || "—"} · ${idea.target_words ?? 1500} words`;

  // Derive a ComposeSettings view from the draft's idea. A fresh object each
  // render is fine — SetupFields effects key on primitive fields, not identity.
  const settings: ComposeSettings = {
    pack_slug: idea.pack_slug,
    format: idea.format ?? null,
    provider: idea.provider,
    model: idea.model,
    target_words: idea.target_words ?? 1500,
    use_voice_profile: idea.use_voice_profile ?? true,
  };

  return (
    <section className="nb-card overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-card-2 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm text-muted">
          <Icon
            name="chevron-right"
            size={14}
            title="toggle"
            className={`transition-transform text-muted-2 ${open ? "rotate-90" : ""}`}
          />
          <span className="font-medium text-ink-2">Setup</span>
          <span className="text-muted">·</span>
          <span className="text-muted">{summary}</span>
        </span>
        <span className="text-cobalt-600 text-xs font-medium">{open ? "Close" : "Edit"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-rule animate-fade-in">
          <SetupFields
            value={settings}
            onChange={(next) => onChange({ ...idea, ...next })}
            autoPickProvider={false}
          />
        </div>
      )}
    </section>
  );
}
