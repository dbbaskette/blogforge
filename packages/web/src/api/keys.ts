import { api } from "./client";

export type KeyStatus = Record<string, boolean>;
export const getKeyStatus = (): Promise<KeyStatus> => api<KeyStatus>("/api/keys");
export const setKey = (provider: string, apiKey: string): Promise<{ status: string }> =>
  api(`/api/keys/${provider}`, { method: "PUT", body: JSON.stringify({ api_key: apiKey }) });
export const deleteKey = (provider: string): Promise<void> =>
  api(`/api/keys/${provider}`, { method: "DELETE" });
