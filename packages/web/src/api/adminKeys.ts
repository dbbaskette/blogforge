import { api } from "./client";

export type Provider = "anthropic" | "openai" | "google";

export interface ProviderKeyStatus {
  provider: Provider;
  configured: boolean;
  /** "stored" | "myvoice" | "none" — UI shows a subtle hint for myvoice fallback. */
  source: "stored" | "myvoice" | "none";
  updated_at: string | null;
  updated_by: string | null;
}

export const listProviderKeys = (): Promise<ProviderKeyStatus[]> =>
  api<ProviderKeyStatus[]>("/api/admin/keys");

export const setProviderKey = (provider: Provider, apiKey: string): Promise<ProviderKeyStatus> =>
  api<ProviderKeyStatus>(`/api/admin/keys/${provider}`, {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey }),
  });

export const deleteProviderKey = (provider: Provider): Promise<void> =>
  api<void>(`/api/admin/keys/${provider}`, { method: "DELETE" });
