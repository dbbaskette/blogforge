import type { DraftStage, Section } from "../../api/drafts";

/**
 * Whether to show the draft tools bar (Improve → GEO / Voice / lint / Humanize /
 * Headlines, plus Export / Preview / Checkup).
 *
 * These tools all operate on composed prose, so the rule is "show them whenever
 * the draft HAS composed content" — NOT "only while the Draft stage tab is
 * active". Gating on `stage === "sections"` alone made every tool vanish the
 * moment a writer flipped back to the Outline tab to tweak structure, or
 * resumed a draft that reopened on an earlier stage — the written draft was
 * right there, but GEO/Voice/lint/Export were gone. See the tools-disappear bug.
 */
export function shouldShowDraftTools(
  stage: DraftStage,
  sections: Pick<Section, "status">[],
): boolean {
  if (sections.length === 0) return false;
  // On the Draft tab, always show — even a fresh (all-failed/empty) section set
  // keeps the bar so the writer can Compose-remaining / export the shell.
  if (stage === "sections") return true;
  // On an earlier tab, show only once something is actually composed.
  return sections.some((s) => s.status === "ready" || s.status === "edited");
}
