/**
 * Ideation API client — research-stage chat: history, send a message
 * (returns a job_id for SSE streaming), and accept the latest proposed
 * outline to advance the draft to the outline stage.
 */

import { api } from "./client";
import type { Draft, OutlineProposal } from "./drafts";

export type IdeationRole = "user" | "assistant";

export interface IdeationMessage {
  id: string;
  position: number;
  role: IdeationRole;
  content: string;
  proposed_outline: OutlineProposal | null;
  timestamp: string;
}

const base = (draftId: string): string => `/api/drafts/${encodeURIComponent(draftId)}/ideation`;

export const listIdeation = (draftId: string): Promise<IdeationMessage[]> =>
  api<IdeationMessage[]>(base(draftId));

export const postIdeationMessage = (
  draftId: string,
  content: string,
): Promise<{ job_id: string }> =>
  api<{ job_id: string }>(`${base(draftId)}/message`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });

export const acceptIdeation = (draftId: string): Promise<Draft> =>
  api<Draft>(`${base(draftId)}/accept`, { method: "POST" });
