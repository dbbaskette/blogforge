import { useEffect } from "react";

import { type JobFrame, connectJobStream } from "./jobStream";

/**
 * Generalized SSE job subscriber. Frames from the server arrive as JSON
 * on a single `message` channel:
 *   {type:"token", delta:"…"}    → onDelta
 *   {type:"stage", name:"…"}     → ignored here (caller can re-implement)
 *   {type:"complete", result:…}  → onResult + onDone
 *   {type:"error", code, message, hint?} → onError
 *
 * The stream reconnects with backoff after a dropped connection; onResync
 * fires before each replay so consumers can clear accumulated buffers.
 * The connection closes on complete, error, or unmount.
 */
export interface StreamJobHandlers {
  onDelta?: (delta: string) => void;
  onResult?: (result: unknown) => void;
  onError?: (err: Error & { code?: string; hint?: string }) => void;
  onDone?: () => void;
  /** Connection re-established after a drop; clear accumulated buffers. */
  onResync?: () => void;
}

export function useStreamJob(jobId: string | null, handlers: StreamJobHandlers): void {
  useEffect(() => {
    if (!jobId) return;
    return connectJobStream({
      jobId,
      onResync: () => handlers.onResync?.(),
      onGiveUp: () => {
        handlers.onError?.(
          Object.assign(new Error("Lost connection to the server."), { code: "stream_lost" }),
        );
        handlers.onDone?.();
      },
      onFrame: (evt: JobFrame) => {
        if (evt.type === "token" && typeof evt.delta === "string") {
          handlers.onDelta?.(evt.delta);
        } else if (evt.type === "complete") {
          handlers.onResult?.(evt.result);
          handlers.onDone?.();
        } else if (evt.type === "error") {
          handlers.onError?.(
            Object.assign(new Error(String(evt.message ?? "stream error")), {
              code: typeof evt.code === "string" ? evt.code : undefined,
              hint: typeof evt.hint === "string" ? evt.hint : undefined,
            }),
          );
          handlers.onDone?.();
        }
        // stage frames are intentionally ignored at this layer.
      },
    });
  }, [jobId, handlers]);
}
