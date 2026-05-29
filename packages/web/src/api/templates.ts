import { api } from "./client";

export interface Template {
  id: string;
  name: string;
  topic: string;
  pack_slug: string;
  provider: "anthropic" | "openai" | "google";
  model: string;
  target_words: number;
  format: string | null;
  bullets: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

export async function listTemplates(init?: RequestInit): Promise<Template[]> {
  return api<Template[]>("/api/templates", init);
}

export async function createTemplateFromDraft(draftId: string, name: string): Promise<Template> {
  return api<Template>(`/api/templates/from-draft/${encodeURIComponent(draftId)}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await api<void>(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}
