export type HumanizationCheckState =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "complete"; count: number };

export interface HumanizationCheckProps {
  voiceRules: HumanizationCheckState;
  humanize: HumanizationCheckState;
  lensCount: number;
}

type Tone = "good" | "warn" | "bad" | "muted";

const TONE_COLOR: Record<Tone, string> = {
  good: "#15a06b",
  warn: "#f59e0b",
  bad: "#e6492d",
  muted: "#8a909c",
};

function summary(
  voiceRules: HumanizationCheckState,
  humanize: HumanizationCheckState,
): { label: string; tone: Tone } {
  if (voiceRules.status === "unavailable" || humanize.status === "unavailable") {
    return { label: "Check incomplete", tone: "muted" };
  }
  if (voiceRules.status === "pending" || humanize.status === "pending") {
    return { label: "Checking humanization…", tone: "muted" };
  }
  if (voiceRules.count > 0) {
    return { label: "Voice rules need attention", tone: "bad" };
  }
  if (humanize.count > 0) {
    return { label: "Review Humanize suggestions", tone: "warn" };
  }
  return { label: "Looks natural", tone: "good" };
}

function voiceDetail(state: HumanizationCheckState): string {
  if (state.status === "pending") return "Checking voice rules…";
  if (state.status === "unavailable") return "Voice-rule check unavailable";
  if (state.count === 0) return "No voice-rule issues";
  return `${state.count} open ${state.count === 1 ? "finding" : "findings"}`;
}

function humanizeDetail(state: HumanizationCheckState, lensCount: number): string {
  if (state.status === "pending") return `Analyzing ${lensCount} lenses…`;
  if (state.status === "unavailable") return "Humanize review unavailable";
  const lenses = `${lensCount} ${lensCount === 1 ? "lens" : "lenses"}`;
  if (state.count === 0) return `No suggestions across ${lenses}`;
  return `${state.count} ${state.count === 1 ? "suggestion" : "suggestions"} across ${lenses}`;
}

function stateTone(state: HumanizationCheckState, kind: "voice" | "humanize"): Tone {
  if (state.status !== "complete") return "muted";
  if (state.count === 0) return "good";
  return kind === "voice" ? "bad" : "warn";
}

function CheckRow({
  label,
  detail,
  tone,
}: {
  label: string;
  detail: string;
  tone: Tone;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink">{label}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}

export function HumanizationCheck({
  voiceRules,
  humanize,
  lensCount,
}: HumanizationCheckProps): JSX.Element {
  const result = summary(voiceRules, humanize);

  return (
    <section
      className="rounded-nb-sm border border-rule bg-card-2 px-3 py-2.5"
      aria-label="Humanization Check"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        Humanization Check
      </p>
      <p className="mt-0.5 text-sm font-semibold" style={{ color: TONE_COLOR[result.tone] }}>
        {result.label}
      </p>
      <div className="mt-1 divide-y divide-rule">
        <CheckRow
          label="Voice-rule check"
          detail={voiceDetail(voiceRules)}
          tone={stateTone(voiceRules, "voice")}
        />
        <CheckRow
          label="Humanize review"
          detail={humanizeDetail(humanize, lensCount)}
          tone={stateTone(humanize, "humanize")}
        />
      </div>
    </section>
  );
}
