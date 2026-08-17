import { useCallback, useEffect, useRef, useState } from "react";
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
import { ErrorNotice } from "../components/ui/ErrorNotice";

interface FailedSave {
  draftId: string;
  snapshot: Draft;
}

export function DraftPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [failedSave, setFailedSave] = useState<FailedSave | null>(null);
  const saveSequence = useRef(0);
  const activeDraftId = useRef(id);

  if (activeDraftId.current !== id) {
    activeDraftId.current = id;
    saveSequence.current += 1;
  }

  const loadDraft = useCallback(async (): Promise<void> => {
    if (!id) return;
    const draftId = id;
    setError(null);
    try {
      const loaded = await getDraft(draftId);
      if (activeDraftId.current === draftId) setDraft(loaded);
    } catch (nextError) {
      if (activeDraftId.current === draftId) setError(nextError);
    }
  }, [id]);

  useEffect(() => {
    setDraft(null);
    setError(null);
    setJobId(null);
    setSaving(false);
    setSaveError(null);
    setFailedSave(null);
    if (!id) return;
    const draftId = id;
    void loadDraft();
    // Resume-watching: if a compose/revise is in flight (e.g. after a page
    // reload), re-attach to its SSE stream so progress keeps streaming.
    getActiveJob(draftId)
      .then(({ job_id }) => {
        if (job_id && activeDraftId.current === draftId) setJobId(job_id);
      })
      .catch(() => {});
  }, [id, loadDraft]);

  const saveDraft = useCallback(
    async (next: Draft): Promise<void> => {
      if (!id) return;
      const draftId = id;
      const sequence = ++saveSequence.current;
      const snapshot = structuredClone(next);
      setSaving(true);
      setSaveError(null);
      try {
        await updateDraft(draftId, snapshot);
        if (sequence !== saveSequence.current || activeDraftId.current !== draftId) return;
        setFailedSave(null);
      } catch (nextError) {
        if (sequence !== saveSequence.current || activeDraftId.current !== draftId) return;
        setSaveError(nextError);
        setFailedSave({ draftId, snapshot });
      } finally {
        if (sequence === saveSequence.current && activeDraftId.current === draftId) {
          setSaving(false);
        }
      }
    },
    [id],
  );

  const onChange = useCallback(
    async (next: Draft) => {
      setDraft(next);
      await saveDraft(next);
    },
    [saveDraft],
  );

  const retrySave = useCallback(async (): Promise<void> => {
    if (!id || !failedSave || failedSave.draftId !== id) return;
    await saveDraft(failedSave.snapshot);
  }, [failedSave, id, saveDraft]);

  const onGenerateOutline = useCallback(async () => {
    if (!id) return;
    const updated = await generateOutline(id);
    setDraft(updated);
  }, [id]);

  const onExpandAll = useCallback(async () => {
    if (!id) return;
    const { job_id } = await expandSections(id);
    setJobId(job_id);
    // The compose runs as a background job. The draft has already advanced to the
    // "sections" stage server-side (see /expand), so pull it now to swap the
    // outline for the live composing view — otherwise the writer sits on a
    // frozen outline with no feedback until the whole job finishes.
    setDraft(await getDraft(id));
  }, [id]);

  const onExpandUnfilled = useCallback(async () => {
    if (!id) return;
    const { job_id } = await expandSections(id, { remainingOnly: true });
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
        <ErrorNotice error={error} operation="loading your draft" onRetry={loadDraft} />
      </div>
    );
  if (!draft || draft.id !== id)
    return <p className="text-center text-muted text-sm py-16">Loading…</p>;

  return (
    <DraftWorkspace
      draft={draft}
      jobId={jobId}
      saving={saving}
      saveError={saveError}
      onRetrySave={retrySave}
      onDismissSaveError={() => setSaveError(null)}
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
