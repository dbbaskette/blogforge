import { api } from "./client";

export type Intensity = "light" | "medium" | "strong";

export interface HumanizeFinding {
  lens: string;
  section_id: string;
  target: string;
  suggestion: string;
  note: string;
  needs_review: boolean;
}
export interface HumanizeLens {
  key: string;
  label: string;
  findings: HumanizeFinding[];
}
export interface HumanizeReport {
  intensity: Intensity;
  score: number;
  lenses: HumanizeLens[];
}

/** On-demand Humanize pass: additive "sound human" rewrites, gated by the
 * Light/Medium/Strong intensity dial. Mirrors `analyzeGeo`. */
export function analyzeHumanize(draftId: string, intensity: Intensity): Promise<HumanizeReport> {
  return api<HumanizeReport>(`/api/drafts/${encodeURIComponent(draftId)}/humanize`, {
    method: "POST",
    body: JSON.stringify({ intensity }),
  });
}
