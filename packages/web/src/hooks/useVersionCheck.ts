import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";

interface Health {
  status: string;
  version: string;
}

/**
 * Guards against a stale cached JS bundle. On mount it records the API's
 * reported version (the version this bundle was loaded against), then polls
 * `/api/health` on an interval. When the server reports a different version,
 * the loaded bundle is stale and `stale` flips to true so the UI can prompt
 * a reload.
 */
export function useVersionCheck(intervalMs = 60_000): { stale: boolean } {
  const [stale, setStale] = useState(false);
  const loadedVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const health = await api<Health>("/api/health");
        if (cancelled || !health?.version) return;
        if (loadedVersion.current === null) {
          // First successful fetch records the baseline.
          loadedVersion.current = health.version;
        } else if (health.version !== loadedVersion.current) {
          setStale(true);
        }
      } catch {
        // Network hiccup — ignore; we'll retry on the next tick.
      }
    };

    void check();
    const id = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return { stale };
}
