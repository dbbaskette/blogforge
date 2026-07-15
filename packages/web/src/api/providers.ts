import { api } from "./client";

export interface ModelInfo {
  id: string;
  label: string;
  context_window: number;
  supports_streaming: boolean;
  input_per_million_usd: number | null;
  output_per_million_usd: number | null;
}

export type Provider = "anthropic" | "openai" | "google" | "claude-cli" | "codex-cli" | "tanzu";

export async function listProviderAvailability(): Promise<Record<string, boolean>> {
  return api("/api/providers");
}

export interface CliStatus {
  installed: boolean;
  authenticated: boolean;
  detail: string;
  resolve: string;
}

export type ClaudeCliStatus = CliStatus;

/** Live probe: is the keyless Claude CLI installed on the host and logged in? */
export async function getClaudeCliStatus(): Promise<ClaudeCliStatus> {
  return api("/api/providers/claude-cli/status");
}

export const getCodexCliStatus = (): Promise<CliStatus> => api("/api/providers/codex-cli/status");

export const getDefaultProvider = (): Promise<{ default_provider: Provider | null }> =>
  api("/api/providers/default");

export const setDefaultProvider = (
  default_provider: Provider,
): Promise<{ default_provider: Provider }> =>
  api("/api/providers/default", {
    method: "PUT",
    body: JSON.stringify({ default_provider }),
  });

export async function listModels(provider: Provider): Promise<ModelInfo[]> {
  return api(`/api/providers/${provider}/models`);
}
