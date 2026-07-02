import { api } from "./client";

export interface PackSummary {
  slug: string;
  name: string;
  version: string;
  valid: boolean;
  error_count: number;
  description: string;
  one_line: string;
}

export interface PackFormatEntry {
  name: string;
  file: string;
  description?: string | null;
}

export async function listPacks(): Promise<PackSummary[]> {
  return api<PackSummary[]>("/api/packs");
}

export async function getManifest(slug: string): Promise<Record<string, unknown>> {
  return api(`/api/packs/${encodeURIComponent(slug)}/manifest`);
}

// Built-in output formats — available regardless of pack/voice source. Same
// {name, description} shape as pack formats so the picker renders them alike;
// `name` is the slug stored on idea.format, `description` is the label.
export async function listFormats(): Promise<PackFormatEntry[]> {
  return api<PackFormatEntry[]>("/api/formats");
}
