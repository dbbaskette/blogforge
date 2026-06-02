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

export async function listModels(
  provider: "anthropic" | "openai" | "google" | "claude-cli",
): Promise<ModelInfo[]> {
  return api(`/api/providers/${provider}/models`);
}
