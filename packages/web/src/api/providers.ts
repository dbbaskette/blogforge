import { api } from "./client";

export interface ModelInfo {
  id: string;
  label: string;
  context_window: number;
  supports_streaming: boolean;
}

export async function listProviderAvailability(): Promise<Record<string, boolean>> {
  return api("/api/providers");
}

export async function listModels(
  provider: "anthropic" | "openai" | "google",
): Promise<ModelInfo[]> {
  return api(`/api/providers/${provider}/models`);
}
