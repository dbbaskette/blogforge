import { apiFetch } from "./client";

export interface PackSummary {
  slug: string;
  name: string;
  version: string;
  valid: boolean;
  error_count: number;
}

export async function listPacks(): Promise<PackSummary[]> {
  return apiFetch<PackSummary[]>("/api/packs");
}
