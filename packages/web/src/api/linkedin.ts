import { api } from "./client";

/** Mirrors the connector's `GET /linkedin/status` payload. */
export interface LinkedInStatus {
  connected: boolean;
  member_name?: string;
  expires_at?: string;
}

/** Mirrors `GET /linkedin/connect`. The URL is opened in the browser to start OAuth. */
export interface LinkedInConnect {
  authorize_url: string;
}

export type LinkedInVisibility = "PUBLIC" | "CONNECTIONS";

export interface LinkedInPublishInput {
  text: string;
  visibility?: LinkedInVisibility;
  draft_id?: string;
}

/** Mirrors the `201` body of `POST /linkedin/publish`. */
export interface LinkedInPublishResult {
  post_urn: string;
  post_id: string;
}

export interface LinkedInPostStats {
  likes: number;
  comments: number;
}

/** Mirrors a row of `GET /linkedin/posts`. */
export interface LinkedInPost {
  id: string;
  post_urn: string;
  commentary: string;
  posted_at: string;
  draft_id: string | null;
  last_stats: LinkedInPostStats | null;
}

/** Mirrors `GET /linkedin/stats/{post_id}`. */
export interface LinkedInStats {
  likes: number;
  comments: number;
  fetched_at: string;
}

export const getLinkedInStatus = (): Promise<LinkedInStatus> =>
  api<LinkedInStatus>("/linkedin/status");

export const connectLinkedIn = (): Promise<LinkedInConnect> =>
  api<LinkedInConnect>("/linkedin/connect");

export const disconnectLinkedIn = (): Promise<void> =>
  api<void>("/linkedin/connection", { method: "DELETE" });

export const publishToLinkedIn = (input: LinkedInPublishInput): Promise<LinkedInPublishResult> =>
  api<LinkedInPublishResult>("/linkedin/publish", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listLinkedInPosts = (): Promise<LinkedInPost[]> =>
  api<LinkedInPost[]>("/linkedin/posts");

export const getLinkedInStats = (postId: string): Promise<LinkedInStats> =>
  api<LinkedInStats>(`/linkedin/stats/${encodeURIComponent(postId)}`);
