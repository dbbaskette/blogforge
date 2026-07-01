import { api } from "./client";

export type SuggestKind = "fact_check" | "reword" | "expand";

export interface Suggestion {
  target: string;
  note: string;
  options: string[];
}

/** Grouped punch-list: kind → suggestions. Kinds may be absent if not requested. */
export type SuggestResult = Partial<Record<SuggestKind, Suggestion[]>>;

/**
 * Run the Shape Assistant's review passes over a draft. Defaults to all three
 * kinds server-side when `kinds` is omitted.
 */
export async function suggestImprovements(
  draftId: string,
  kinds?: SuggestKind[],
): Promise<SuggestResult> {
  const { suggestions } = await api<{ suggestions: SuggestResult }>(
    `/api/drafts/${encodeURIComponent(draftId)}/suggest`,
    { method: "POST", body: JSON.stringify(kinds ? { kinds } : {}) },
  );
  return suggestions;
}
