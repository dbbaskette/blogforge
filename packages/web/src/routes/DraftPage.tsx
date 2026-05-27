import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  type Draft,
  type DraftStage,
  expandSections,
  generateOutline,
  getDraft,
  regenerateSection,
  reorderSections,
  saveSection,
  updateDraft,
} from "../api/drafts";
import { Stage1Idea } from "../components/draft/Stage1Idea";
import { Stage2Outline } from "../components/draft/Stage2Outline";
import { Stage3Sections } from "../components/draft/Stage3Sections";
import { StageIndicator } from "../components/draft/StageIndicator";

export function DraftPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getDraft(id)
      .then(setDraft)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const onChange = useCallback(
    async (next: Draft) => {
      setDraft(next);
      if (id) {
        await updateDraft(id, next).catch(() => {
          // tolerate
        });
      }
    },
    [id],
  );

  const onGenerateOutline = useCallback(async () => {
    if (!id) return;
    const updated = await generateOutline(id);
    setDraft(updated);
  }, [id]);

  const onExpandAll = useCallback(async () => {
    if (!id || !draft) return;
    const updated = { ...draft, stage: "sections" as DraftStage };
    setDraft(updated);
    const { job_id } = await expandSections(id);
    setJobId(job_id);
  }, [id, draft]);

  // Same as onExpandAll but for use inside Stage 3 — doesn't change stage.
  const onExpandUnfilled = useCallback(async () => {
    if (!id) return;
    const { job_id } = await expandSections(id);
    setJobId(job_id);
  }, [id]);

  const onJobComplete = useCallback(() => {
    if (!id) return;
    getDraft(id)
      .then(setDraft)
      .catch(() => {});
  }, [id]);

  const onGoTo = useCallback(
    (stage: DraftStage) => {
      if (!draft) return;
      if (stage === "sections" && draft.outline === null) return;
      setDraft({ ...draft, stage });
    },
    [draft],
  );

  if (!id) {
    navigate("/");
    return <div />;
  }
  if (error)
    return (
      <div className="max-w-4xl mx-auto">
        <div className="border-l-2 border-vermilion pl-4 py-3 bg-vermilion-900/30">
          <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400">
            error
          </p>
          <p className="text-sm text-cream/85 mt-1">{error}</p>
        </div>
      </div>
    );
  if (!draft)
    return (
      <p className="font-mono text-[10px] uppercase tracking-wide-3 text-muted text-center py-16">
        …setting type…
      </p>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <StageIndicator current={draft.stage} onGoTo={onGoTo} />

      {draft.stage === "idea" && (
        <Stage1Idea draft={draft} onChange={onChange} onAdvance={onGenerateOutline} />
      )}
      {draft.stage === "outline" && (
        <Stage2Outline
          draft={draft}
          onChange={onChange}
          onAdvance={onExpandAll}
          onRegenerate={onGenerateOutline}
          onBack={() => onGoTo("idea")}
        />
      )}
      {draft.stage === "sections" && (
        <Stage3Sections
          draft={draft}
          jobId={jobId}
          onSectionSave={async (sid, md) => setDraft(await saveSection(id, sid, md))}
          onRegenerateSection={async (sid) => {
            const { job_id } = await regenerateSection(id, sid);
            setJobId(job_id);
          }}
          onReorder={async (ids) => setDraft(await reorderSections(id, ids))}
          onExpandUnfilled={onExpandUnfilled}
          onJobComplete={onJobComplete}
        />
      )}
    </div>
  );
}
