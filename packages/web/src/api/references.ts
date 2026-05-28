/**
 * References API client — every research-stage draft can have attached
 * references (URLs, pasted text, or uploaded files) that the LLM uses
 * to ground its outlines and sections.
 */

import { api } from "./client";

export type ReferenceKind = "url" | "file" | "text";

export interface Reference {
  id: string;
  kind: ReferenceKind;
  name: string;
  url: string | null;
  original_filename: string | null;
  extracted_chars: number;
  added_at: string;
}

const base = (draftId: string): string => `/api/drafts/${encodeURIComponent(draftId)}/references`;

export const listReferences = (draftId: string): Promise<Reference[]> =>
  api<Reference[]>(base(draftId));

export const addUrlReference = (draftId: string, url: string, name?: string): Promise<Reference> =>
  api<Reference>(`${base(draftId)}/url`, {
    method: "POST",
    body: JSON.stringify(name ? { url, name } : { url }),
  });

export const addTextReference = (
  draftId: string,
  name: string,
  content: string,
): Promise<Reference> =>
  api<Reference>(`${base(draftId)}/text`, {
    method: "POST",
    body: JSON.stringify({ name, content }),
  });

/**
 * Multi-part upload — must let the browser set Content-Type so the
 * boundary is generated. We bypass the api() wrapper for this one.
 */
export async function addFileReference(
  draftId: string,
  file: File,
  name?: string,
): Promise<Reference> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  const BASE = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${BASE}${base(draftId)}/file`, {
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
  return (await res.json()) as Reference;
}

export const deleteReference = (draftId: string, refId: string): Promise<void> =>
  api<void>(`${base(draftId)}/${encodeURIComponent(refId)}`, { method: "DELETE" });
