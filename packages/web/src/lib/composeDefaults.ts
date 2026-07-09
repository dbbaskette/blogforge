export interface ComposeSettings {
  pack_slug: string;
  format: string | null;
  provider: "anthropic" | "openai" | "google" | "claude-cli" | "tanzu";
  model: string;
  target_words: number;
  use_voice_profile: boolean;
}

const KEY = "bf.compose.defaults";

const FALLBACK: ComposeSettings = {
  pack_slug: "",
  format: null,
  // Prefer the local Claude CLI (Max subscription) by default; SetupFields
  // falls back to an available API-key provider when the binary isn't installed.
  provider: "claude-cli",
  model: "",
  target_words: 1500,
  use_voice_profile: true,
};

export function loadDefaults(): ComposeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...FALLBACK };
    // Trusting the stored shape: only our own saveDefaults writes this key.
    // If that ever changes, add a runtime validator here.
    const parsed = JSON.parse(raw) as Partial<ComposeSettings>;
    return { ...FALLBACK, ...parsed };
  } catch {
    return { ...FALLBACK };
  }
}

export function saveDefaults(s: ComposeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage disabled — non-fatal */
  }
}

const MODE_KEY = "bf.compose.lastMode";
const VALID_MODES = ["outline", "propose", "express", "blank", "paste"] as const;
export type StoredMode = (typeof VALID_MODES)[number];

/** The mode the writer last composed with, so returning users skip re-picking. */
export function loadLastMode(): StoredMode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return VALID_MODES.includes(raw as StoredMode) ? (raw as StoredMode) : null;
  } catch {
    return null;
  }
}

export function saveLastMode(mode: StoredMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage disabled — non-fatal */
  }
}
