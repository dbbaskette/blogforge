import { useEffect } from "react";

/**
 * Generalized SSE job subscriber. Frames from the server arrive as JSON
 * on a single `message` channel:
 *   {type:"token", delta:"…"}    → onDelta
 *   {type:"stage", name:"…"}     → ignored here (caller can re-implement)
 *   {type:"complete", result:…}  → onResult + onDone
 *   {type:"error", code, message, hint?} → onError
 *
 * The EventSource closes on complete, error, or unmount.
 */
export interface StreamJobHandlers {
  onDelta?: (delta: string) => void;
  onResult?: (result: unknown) => void;
  onError?: (err: Error & { code?: string; hint?: string }) => void;
  onDone?: () => void;
}

export function useStreamJob(jobId: string | null, handlers: StreamJobHandlers): void {
  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as {
          type: string;
          [k: string]: unknown;
        };
        if (evt.type === "token" && typeof evt.delta === "string") {
          handlers.onDelta?.(evt.delta);
        } else if (evt.type === "complete") {
          handlers.onResult?.(evt.result);
          handlers.onDone?.();
          es.close();
        } else if (evt.type === "error") {
          const err = Object.assign(new Error(String(evt.message ?? "stream error")), {
            code: typeof evt.code === "string" ? evt.code : undefined,
            hint: typeof evt.hint === "string" ? evt.hint : undefined,
          });
          handlers.onError?.(err);
          handlers.onDone?.();
          es.close();
        }
        // stage frames are intentionally ignored at this layer.
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [jobId, handlers]);
}
