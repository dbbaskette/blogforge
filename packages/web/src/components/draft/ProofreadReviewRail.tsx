/**
 * The Proofreader's findings rendered on the shared issue-card model — the same
 * IssueCard + useIssueLifecycle the GEO rail uses, so the two review surfaces
 * behave identically (open → review → accept, per-issue undo).
 */

import { useMemo } from "react";

import type { Draft } from "../../api/drafts";
import { type LintResult, proofreadFindingsToIssues } from "../../lib/issues/proofreadAdapter";
import { IssueCard } from "../review/IssueCard";
import { useIssueLifecycle } from "../review/useIssueLifecycle";
import { makeProofreadApply } from "./proofreadApply";

export interface ProofreadReviewRailProps {
  lint: LintResult;
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onHighlight?: (sectionId: string, text: string | null, kind: "under-review" | "locate") => void;
}

export function ProofreadReviewRail({
  lint,
  draft,
  onSectionSave,
  onHighlight,
}: ProofreadReviewRailProps): JSX.Element {
  const issues = useMemo(() => proofreadFindingsToIssues(lint), [lint]);
  const apply = useMemo(() => makeProofreadApply({ draft, onSectionSave }), [draft, onSectionSave]);
  const { statusOf, busyId, run, accept, undo } = useIssueLifecycle({
    draftId: draft.id,
    apply,
    save: onSectionSave,
    onHighlight,
  });

  if (issues.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">No proofreading issues. Clean draft.</p>
    );
  }

  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <IssueCard
          key={issue.id}
          issue={{ ...issue, status: statusOf(issue) }}
          busy={busyId === issue.id}
          onAction={(action, inputText) => void run(issue, action, inputText)}
          onAccept={() => accept(issue)}
          onUndo={() => void undo(issue)}
        />
      ))}
    </div>
  );
}
