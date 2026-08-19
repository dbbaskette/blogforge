/**
 * Single source of truth for talking to the BlogForge API.
 * Every call rides the session cookie via `credentials: "include"` so
 * cross-origin dev (vite :7881 -> api :7880) works without manual config.
 */

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface ApiError extends Error {
  status: number;
  code?: string;
  detail?: unknown;
  repositoryUrl?: string;
  path?: string;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: unknown, key: string): string | undefined {
  return isJsonObject(value) && typeof value[key] === "string" ? value[key] : undefined;
}

/** Parse one failed response into a safe, metadata-rich API error.
 * The body is read exactly once so JSON and multipart callers behave alike. */
export async function parseResponseError(res: Response): Promise<ApiError> {
  const raw = await res.text();
  let payload: unknown;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = undefined;
    }
  }

  const payloadObject = isJsonObject(payload) ? payload : undefined;
  const detail = payloadObject
    ? "detail" in payloadObject
      ? payloadObject.detail
      : payload
    : raw || undefined;
  const detailObject = isJsonObject(detail) ? detail : undefined;
  const structured =
    detailObject?.error ?? detailObject ?? (payloadObject ? payloadObject.error : undefined);
  const message = stringProperty(structured, "message");
  const code = stringProperty(structured, "code");
  const repositoryUrl = stringProperty(structured, "repository_url");
  const errorPath = stringProperty(structured, "path");

  return Object.assign(
    new Error(
      message ??
        (res.status === 401
          ? "Your session has expired. Please sign in again."
          : "The request could not be completed."),
    ),
    {
      status: res.status,
      code,
      detail,
      repositoryUrl,
      path: errorPath,
    },
  );
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    throw await parseResponseError(res);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("Content-Type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/**
 * Legacy alias kept for compatibility with existing callers.
 * Prefer `api()` going forward.
 */
export const apiFetch = api;
