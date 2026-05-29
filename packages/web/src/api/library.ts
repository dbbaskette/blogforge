/**
 * Reference library API client — references a user can reuse across drafts.
 */
import { api } from "./client";
import type { Reference, ReferenceKind } from "./references";

export interface LibraryReference {
  id: string;
  kind: ReferenceKind;
  name: string;
  url: string | null;
  original_filename: string | null;
  extracted_chars: number;
  added_at: string;
}

export const listLibraryReferences = (init?: RequestInit): Promise<LibraryReference[]> =>
  api<LibraryReference[]>("/api/library/references", init);

export const promoteToLibrary = (draftId: string, refId: string): Promise<LibraryReference> =>
  api<LibraryReference>(
    `/api/library/references/from-draft/${encodeURIComponent(draftId)}/${encodeURIComponent(refId)}`,
    { method: "POST" },
  );

export const deleteLibraryReference = (libId: string): Promise<void> =>
  api<void>(`/api/library/references/${encodeURIComponent(libId)}`, { method: "DELETE" });

export const addReferenceFromLibrary = (draftId: string, libId: string): Promise<Reference> =>
  api<Reference>(
    `/api/drafts/${encodeURIComponent(draftId)}/references/from-library/${encodeURIComponent(libId)}`,
    { method: "POST" },
  );
