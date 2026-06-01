import { api } from "./client";

export interface IdeaInput {
  topic: string;
  bullets?: string[];
  pack_slug: string;
  format?: string | null;
  provider: "anthropic" | "openai" | "google";
  model: string;
  target_words?: number;
  notes?: string;
}

export interface OutlineSection {
  id: string;
  title: string;
  brief: string;
}
export interface OutlineProposal {
  opening_hook: string;
  sections: OutlineSection[];
  estimated_words: number;
}
export type SectionStatus = "empty" | "generating" | "ready" | "failed" | "edited";
export interface Section {
  id: string;
  title: string;
  brief: string;
  content_md: string;
  status: SectionStatus;
  last_generated_at: string | null;
  last_error?: string | null;
  word_count: number;
}
export type DraftStage = "research" | "outline" | "sections";
export interface Draft {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  stage: DraftStage;
  idea: IdeaInput;
  outline: OutlineProposal | null;
  sections: Section[];
  tags: string[];
  hero_image_key: string | null;
}
export interface DraftSummary {
  id: string;
  title: string;
  stage: DraftStage;
  pack_slug: string;
  updated_at: string;
  word_count: number;
  tags: string[];
}

export async function listDrafts(init?: RequestInit): Promise<DraftSummary[]> {
  return api<DraftSummary[]>("/api/drafts", init);
}
export async function createDraft(idea: IdeaInput): Promise<Draft> {
  return api<Draft>("/api/drafts", { method: "POST", body: JSON.stringify(idea) });
}
export async function getDraft(id: string, init?: RequestInit): Promise<Draft> {
  return api<Draft>(`/api/drafts/${encodeURIComponent(id)}`, init);
}
export async function updateDraft(id: string, draft: Draft): Promise<Draft> {
  return api<Draft>(`/api/drafts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(draft),
  });
}
export async function deleteDraft(id: string): Promise<void> {
  await api<void>(`/api/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function setDraftTags(id: string, tags: string[]): Promise<Draft> {
  return api<Draft>(`/api/drafts/${encodeURIComponent(id)}/tags`, {
    method: "PATCH",
    body: JSON.stringify({ tags }),
  });
}
export async function listTrashedDrafts(init?: RequestInit): Promise<DraftSummary[]> {
  return api<DraftSummary[]>("/api/drafts/trash", init);
}
export async function restoreDraft(id: string): Promise<Draft> {
  return api<Draft>(`/api/drafts/${encodeURIComponent(id)}/restore`, { method: "POST" });
}
export async function hardDeleteDraft(id: string): Promise<void> {
  await api<void>(`/api/drafts/${encodeURIComponent(id)}?hard=true`, { method: "DELETE" });
}

export async function generateOutline(id: string): Promise<Draft> {
  return api<Draft>(`/api/drafts/${encodeURIComponent(id)}/outline`, { method: "POST" });
}
export async function expandSections(id: string, limit?: number): Promise<{ job_id: string }> {
  const qs = limit != null ? `?limit=${limit}` : "";
  return api(`/api/drafts/${encodeURIComponent(id)}/expand${qs}`, { method: "POST" });
}
export async function getActiveJob(
  id: string,
  init?: RequestInit,
): Promise<{ job_id: string | null }> {
  return api(`/api/drafts/${encodeURIComponent(id)}/active-job`, init);
}
export async function setDraftStage(id: string, stage: DraftStage): Promise<Draft> {
  return api<Draft>(`/api/drafts/${encodeURIComponent(id)}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
}
export async function reviseDraft(id: string, instruction: string): Promise<{ job_id: string }> {
  return api(`/api/drafts/${encodeURIComponent(id)}/revise`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}
export async function regenerateSection(
  id: string,
  sectionId: string,
  instruction = "",
): Promise<{ job_id: string }> {
  return api(
    `/api/drafts/${encodeURIComponent(id)}/sections/${encodeURIComponent(sectionId)}/regenerate`,
    { method: "POST", body: JSON.stringify({ instruction }) },
  );
}

export type VersionSource = "regenerate" | "save" | "revert";
export interface SectionVersion {
  id: string;
  section_id: string;
  title: string;
  content_md: string;
  word_count: number;
  status: SectionStatus;
  source: VersionSource;
  created_at: string;
}
export async function listSectionVersions(
  id: string,
  sectionId: string,
  init?: RequestInit,
): Promise<SectionVersion[]> {
  return api<SectionVersion[]>(
    `/api/drafts/${encodeURIComponent(id)}/sections/${encodeURIComponent(sectionId)}/versions`,
    init,
  );
}
export async function revertSectionVersion(
  id: string,
  sectionId: string,
  versionId: string,
): Promise<Draft> {
  return api<Draft>(
    `/api/drafts/${encodeURIComponent(id)}/sections/${encodeURIComponent(
      sectionId,
    )}/versions/${encodeURIComponent(versionId)}/revert`,
    { method: "POST" },
  );
}
export async function saveSection(
  id: string,
  sectionId: string,
  content_md: string,
): Promise<Draft> {
  return api(
    `/api/drafts/${encodeURIComponent(id)}/sections/${encodeURIComponent(sectionId)}/save`,
    {
      method: "POST",
      body: JSON.stringify({ content_md }),
    },
  );
}
export async function reorderSections(id: string, section_ids: string[]): Promise<Draft> {
  return api(`/api/drafts/${encodeURIComponent(id)}/sections/reorder`, {
    method: "POST",
    body: JSON.stringify({ section_ids }),
  });
}
export type ExportFormat = "md" | "html" | "docx";
export function downloadDraftUrl(
  id: string,
  opts?: { format?: ExportFormat; frontmatter?: boolean },
): string {
  const params = new URLSearchParams();
  if (opts?.format) params.set("format", opts.format);
  if (opts?.frontmatter) params.set("frontmatter", "true");
  const qs = params.toString();
  return `/api/drafts/${encodeURIComponent(id)}/download${qs ? `?${qs}` : ""}`;
}
export async function lintDraft(
  id: string,
): Promise<{ violations: unknown[]; hits: unknown[]; repetitions: unknown[] }> {
  return api(`/api/drafts/${encodeURIComponent(id)}/lint`, { method: "POST" });
}

/** Generate an AI hero image for the draft (Google Imagen). */
export async function generateHeroImage(
  draftId: string,
  prompt = "",
): Promise<{ hero_image_key: string }> {
  return api(`/api/drafts/${encodeURIComponent(draftId)}/hero-image`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export async function deleteHeroImage(draftId: string): Promise<void> {
  await api(`/api/drafts/${encodeURIComponent(draftId)}/hero-image`, { method: "DELETE" });
}

/** Same-origin URL for the stored hero image; `v` busts cache on regenerate. */
export function heroImageUrl(draftId: string, version: string): string {
  return `/api/drafts/${encodeURIComponent(draftId)}/hero-image?v=${encodeURIComponent(version)}`;
}

export interface ClaimResult {
  text: string;
  status: "supported" | "unsupported" | "contradicted";
  note: string;
}

/** Fact-check the draft's claims against its attached references (LLM call). */
export async function checkClaims(
  draftId: string,
): Promise<{ claims: ClaimResult[]; has_references: boolean }> {
  return api(`/api/drafts/${encodeURIComponent(draftId)}/claims`, { method: "POST" });
}

export type InlineAction = "rephrase" | "shorten" | "expand" | "fix" | "custom";

/** Voice-aware rewrite of a selected passage (inline AI editing). */
export async function inlineEdit(
  draftId: string,
  body: { text: string; action: InlineAction; instruction?: string },
): Promise<{ text: string }> {
  return api(`/api/drafts/${encodeURIComponent(draftId)}/inline`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Alternative titles or opening hooks for a draft (headline lab). */
export async function generateHeadlines(
  draftId: string,
  kind: "title" | "hook",
  n = 5,
): Promise<{ kind: string; options: string[] }> {
  return api(`/api/drafts/${encodeURIComponent(draftId)}/headlines`, {
    method: "POST",
    body: JSON.stringify({ kind, n }),
  });
}

export interface RepurposeFormat {
  id: string;
  label: string;
}

export async function listRepurposeFormats(): Promise<RepurposeFormat[]> {
  return api("/api/repurpose/formats");
}

/** Turn a finished draft into another channel (X thread, LinkedIn, etc.). */
export async function repurposeDraft(
  draftId: string,
  format: string,
): Promise<{ format: string; text: string }> {
  return api(`/api/drafts/${encodeURIComponent(draftId)}/repurpose`, {
    method: "POST",
    body: JSON.stringify({ format }),
  });
}
