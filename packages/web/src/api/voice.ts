/**
 * Voice Profile API client — manages the user's voice profile, writing
 * rules, style samples, and distillation.
 */

import { api } from "./client";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface VoiceRules {
  banished_words: string[];
  banished_phrases: string[];
  no_em_dashes: boolean;
  no_ascii_double_hyphen: boolean;
}

export interface VoiceSample {
  id: string;
  kind: "text" | "url" | "file";
  name: string;
  source_url: string | null;
  original_filename: string | null;
  s3_key: string;
  extracted_chars: number;
  exemplar: boolean;
  status: "ready" | "failed";
  added_at: string;
}

export interface VoiceSource {
  id: string;
  url: string;
  name: string;
  status: "ready" | "failed";
  extracted_chars: number;
  added_at: string;
}

export interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  persona_identity: string;
  persona_one_line: string;
  persona_tone: string;
  rules: VoiceRules;
  distilled_style_md: string;
  distilled_at: string | null;
  version: number;
  samples: VoiceSample[];
}

/**
 * The six tonal axes of a voice fingerprint, each 0–100. `null` when there's
 * no model or too few samples to map tones.
 */
export interface VoiceDimensions {
  casual: number;
  vivid: number;
  punchy: number;
  warm: number;
  concrete: number;
  direct: number;
}

export interface VoiceFingerprint {
  name: string;
  one_line: string;
  /** Overall voice strength, 0–100. */
  strength: number;
  sample_count: number;
  /** Six tonal axes, or null if no model / too few samples. */
  dimensions: VoiceDimensions | null;
  signature_phrases: string[];
  top_words: string[];
  /** Sentence lengths (words), roughly 0–40 each. */
  rhythm: number[];
  avg_sentence_len: number;
  banished: string[];
}

// ---------------------------------------------------------------------------
// Persona & rules
// ---------------------------------------------------------------------------

export function getVoiceProfile(): Promise<VoiceProfile> {
  return api<VoiceProfile>("/api/voice");
}

export function updatePersona(body: {
  identity: string;
  one_line: string;
  tone: string;
}): Promise<VoiceProfile> {
  return api<VoiceProfile>("/api/voice/persona", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function updateRules(rules: VoiceRules): Promise<VoiceProfile> {
  return api<VoiceProfile>("/api/voice/rules", {
    method: "PUT",
    body: JSON.stringify(rules),
  });
}

export function updateDistilled(distilled_style_md: string): Promise<VoiceProfile> {
  return api<VoiceProfile>("/api/voice/distilled", {
    method: "PUT",
    body: JSON.stringify({ distilled_style_md }),
  });
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export function addTextSample(body: { name: string; text: string }): Promise<VoiceSample> {
  return api<VoiceSample>("/api/voice/samples/text", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function addUrlSample(url: string): Promise<VoiceSample> {
  return api<VoiceSample>("/api/voice/samples/url", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/**
 * Multipart file upload — must let the browser set Content-Type so the
 * boundary is generated automatically. We bypass the api() wrapper and
 * call fetch directly (mirrors the references file-upload helper).
 */
export async function uploadSampleFile(file: File): Promise<VoiceSample> {
  const form = new FormData();
  form.append("file", file);
  const BASE = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${BASE}/api/voice/samples/file`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const j = await res.json();
      detail =
        typeof j?.detail === "string" ? j.detail : (j?.detail?.error?.message ?? JSON.stringify(j));
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`), {
      status: res.status,
      code: detail,
    });
  }
  return (await res.json()) as VoiceSample;
}

export function deleteSample(id: string): Promise<void> {
  return api<void>(`/api/voice/samples/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setExemplar(id: string, exemplar: boolean): Promise<VoiceProfile> {
  return api<VoiceProfile>(`/api/voice/samples/${encodeURIComponent(id)}/exemplar`, {
    method: "PUT",
    body: JSON.stringify({ exemplar }),
  });
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export function listSources(): Promise<VoiceSource[]> {
  return api<VoiceSource[]>("/api/voice/sources");
}

export function addUrlSource(url: string): Promise<VoiceSource> {
  return api<VoiceSource>("/api/voice/sources", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function deleteSource(id: string): Promise<void> {
  return api<void>(`/api/voice/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------------

export function distill(body?: { provider?: string; model?: string }): Promise<VoiceProfile> {
  return api<VoiceProfile>("/api/voice/distill", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Fingerprint & audition
// ---------------------------------------------------------------------------

/** Fetch the shareable voice fingerprint (radar, rhythm, signature phrases). */
export const getVoiceFingerprint = (): Promise<VoiceFingerprint> =>
  api<VoiceFingerprint>("/api/voice/fingerprint");

/** Rewrite a snippet in the user's voice. Returns the original + rewritten. */
export const auditionVoice = (text: string): Promise<{ original: string; rewritten: string }> =>
  api<{ original: string; rewritten: string }>("/api/voice/audition", {
    method: "POST",
    body: JSON.stringify({ text }),
  });

// ---------------------------------------------------------------------------
// LinkedIn import
// ---------------------------------------------------------------------------

/**
 * Multipart LinkedIn data-export upload — must let the browser set
 * Content-Type so the boundary is generated automatically. Bypasses the
 * api() wrapper and calls fetch directly (mirrors uploadSampleFile).
 */
export async function importLinkedIn(file: File): Promise<VoiceProfile> {
  const form = new FormData();
  form.append("file", file);
  const BASE = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${BASE}/api/voice/import/linkedin`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const j = await res.json();
      detail = typeof j?.detail === "string" ? j.detail : (j?.detail?.error?.message ?? JSON.stringify(j));
    } catch { /* ignore */ }
    throw Object.assign(new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`), { status: res.status });
  }
  return (await res.json()) as VoiceProfile;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Returns the URL for downloading the voice profile export ZIP.
 * Mirrors `downloadDraftUrl`'s base-URL handling so it works in dev
 * where the Vite proxy forwards /api to a different port.
 */
export function voiceExportUrl(): string {
  return `/api/voice/export`;
}

/** URL for downloading the portable Markdown voice guide. */
export function voiceGuideUrl(): string {
  return `/api/voice/guide.md`;
}
