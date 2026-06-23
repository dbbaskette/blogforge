/**
 * Single source of truth for talking to the BlogForge API.
 * Every call rides the session cookie via `credentials: "include"` so
 * cross-origin dev (vite :7881 -> api :7880) works without manual config.
 */

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface ApiError extends Error {
  status: number;
  code?: string;
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
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      window.location?.pathname !== "/login"
    ) {
      // Session expired or never signed in — bounce to the login screen
      // instead of letting callers render a raw "HTTP 401" banner mid-page.
      try {
        window.location.assign("/login");
      } catch {
        /* jsdom (tests) has no navigation — ignore */
      }
    }
    let detail: string | undefined;
    try {
      const j = await res.json();
      detail =
        typeof j?.detail === "string" ? j.detail : (j?.detail?.error?.message ?? JSON.stringify(j));
    } catch {
      /* fall through */
    }
    const err: ApiError = Object.assign(
      new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`),
      {
        status: res.status,
        code: detail,
      },
    );
    throw err;
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
