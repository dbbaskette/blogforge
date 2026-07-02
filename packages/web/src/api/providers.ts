import { api } from "./client";

export interface ModelInfo {
  id: string;
  label: string;
  context_window: number;
  supports_streaming: boolean;
  input_per_million_usd: number | null;
  output_per_million_usd: number | null;
}

export async function listProviderAvailability(): Promise<Record<string, boolean>> {
  return api("/api/providers");
}

export interface ClaudeCliStatus {
  installed: boolean;
  authenticated: boolean;
  detail: string;
  resolve: string;
}

/** Live probe: is the keyless Claude CLI installed on the host and logged in? */
export async function getClaudeCliStatus(): Promise<ClaudeCliStatus> {
  return api("/api/providers/claude-cli/status");
}

export async function listModels(
  provider: "anthropic" | "openai" | "google" | "claude-cli" | "tanzu",
): Promise<ModelInfo[]> {
  return api(`/api/providers/${provider}/models`);
}
