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

export type IdeationMode = "ideate" | "interview";

export const postIdeationMessage = (
  draftId: string,
  content: string,
  mode: IdeationMode = "ideate",
): Promise<{ job_id: string }> =>
  api<{ job_id: string }>(`${base(draftId)}/message`, {
    method: "POST",
    body: JSON.stringify({ content, mode }),
  });

export const acceptIdeation = (draftId: string): Promise<Draft> =>
  api<Draft>(`${base(draftId)}/accept`, { method: "POST" });

export interface TopicIdea {
  title: string;
  angle: string;
}

export interface SparkTopicsInput {
  seed?: string;
  provider: string;
  model: string;
  use_voice_profile: boolean;
  pack_slug: string;
  n?: number;
}

/**
 * Draft-free topic brainstorm for the compose screen's "Spark ideas" button.
 * Returns voice-aware post ideas the writer can click to fill the Topic box.
 */
export const sparkTopics = (input: SparkTopicsInput): Promise<{ topics: TopicIdea[] }> =>
  api<{ topics: TopicIdea[] }>("/api/ideation/topics", {
    method: "POST",
    body: JSON.stringify(input),
  });
