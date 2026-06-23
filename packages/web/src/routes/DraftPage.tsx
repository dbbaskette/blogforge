import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  type Draft,
  type DraftStage,
  expandSections,
  generateOutline,
  getActiveJob,
  getDraft,
  regenerateSection,
  reorderSections,
  revertSectionVersion,
  reviseDraft,
  saveSection,
  setDraftStage,
  updateDraft,
} from "../api/drafts";
import { DraftWorkspace } from "../components/draft/DraftWorkspace";

export function DraftPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getDraft(id)
      .then(setDraft)
      .catch((e: Error) => setError(e.message));
    // Resume-watching: if a compose/revise is in flight (e.g. after a page
    // reload), re-attach to its SSE stream so progress keeps streaming.
    getActiveJob(id)
      .then(({ job_id }) => {
        if (job_id) setJobId(job_id);
      })
      .catch(() => {});
  }, [id]);

  const onChange = useCallback(
    async (next: Draft) => {
      setDraft(next);
      if (!id) return;
      setSaving(true);
      setSaveError(null);
      try {
        await updateDraft(id, next);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
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
    if (!id) return;
    const { job_id } = await expandSections(id);
    setJobId(job_id);
  }, [id]);

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

  const onSectionSave = useCallback(
    async (sectionId: string, content_md: string, createVersion = true) => {
      if (!id) return;
      setDraft(await saveSection(id, sectionId, content_md, createVersion));
    },
    [id],
  );

  const onRegenerateSection = useCallback(
    async (sectionId: string, instruction?: string) => {
      if (!id) return;
      const { job_id } = await regenerateSection(id, sectionId, instruction ?? "");
      setJobId(job_id);
    },
    [id],
  );

  const onRevertSection = useCallback(
    async (sectionId: string, versionId: string) => {
      if (!id) return;
      setDraft(await revertSectionVersion(id, sectionId, versionId));
    },
    [id],
  );

  const onReviseDraft = useCallback(
    async (instruction: string) => {
      if (!id) return;
      const { job_id } = await reviseDraft(id, instruction);
      setJobId(job_id);
    },
    [id],
  );

  const onJumpStage = useCallback(
    async (stage: DraftStage) => {
      if (!id) return;
      setDraft(await setDraftStage(id, stage));
    },
    [id],
  );

  const onReorder = useCallback(
    async (section_ids: string[]) => {
      if (!id) return;
      setDraft(await reorderSections(id, section_ids));
    },
    [id],
  );

  if (!id) {
    navigate("/");
    return <div />;
  }
  if (error)
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div
          className="px-4 py-3 rounded-nb"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider">Error</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  if (!draft) return <p className="text-center text-muted text-sm py-16">Loading…</p>;

  return (
    <DraftWorkspace
      draft={draft}
      jobId={jobId}
      saving={saving}
      saveError={saveError}
      onChange={onChange}
      onGenerateOutline={onGenerateOutline}
      onExpandAll={onExpandAll}
      onExpandUnfilled={onExpandUnfilled}
      onSectionSave={onSectionSave}
      onRegenerateSection={onRegenerateSection}
      onRevertSection={onRevertSection}
      onReviseDraft={onReviseDraft}
      onJumpStage={onJumpStage}
      onReorder={onReorder}
      onJobComplete={onJobComplete}
    />
  );
}
