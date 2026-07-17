import { api } from "./client";

export type PublishingPreset = "hugo" | "jekyll" | "plain";

export interface PublishingDestination {
  owner: string;
  repo: string;
  branch: string;
  content_dir: string;
  frontmatter_preset: PublishingPreset;
}

export interface PublishingSettings extends PublishingDestination {
  configured: boolean;
  token_set: boolean;
  validated_login: string | null;
  ready: boolean;
}

export interface PublishingTokenResult {
  token_set: boolean;
  login: string;
}

export interface PublishingValidation {
  ready: boolean;
  validated_login: string;
  private: boolean;
}

export function getPublishingSettings(): Promise<PublishingSettings> {
  return api<PublishingSettings>("/api/publishing/settings");
}

export function savePublishingSettings(
  destination: PublishingDestination,
): Promise<PublishingSettings> {
  return api<PublishingSettings>("/api/publishing/settings", {
    method: "PUT",
    body: JSON.stringify(destination),
  });
}

export function savePublishingToken(token: string): Promise<PublishingTokenResult> {
  return api<PublishingTokenResult>("/api/publishing/token", {
    method: "PUT",
    body: JSON.stringify({ token }),
  });
}

export function clearPublishingToken(): Promise<void> {
  return api<void>("/api/publishing/token", { method: "DELETE" });
}

export function validatePublishingSettings(): Promise<PublishingValidation> {
  return api<PublishingValidation>("/api/publishing/validate", { method: "POST" });
}
