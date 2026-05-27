import { api } from "./client";

export interface PackSummary {
  slug: string;
  name: string;
  version: string;
  valid: boolean;
  error_count: number;
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
