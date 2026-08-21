import { useEffect } from "react";

import { type JobFrame, connectJobStream } from "./jobStream";

export interface ExpandJobHandlers {
  onSectionStart: (sectionId: string) => void;
  onSectionDone: (sectionId: string) => void;
  /** Per-token prose delta (single-section regenerate streaming). */
  onToken?: (delta: string) => void;
  onComplete: (result: {
    draft_id: string;
    sections_done: number;
    sections_failed: number;
  }) => void;
  onError: (code: string, message: string, hint?: string) => void;
  /** Connection re-established after a drop; clear accumulated buffers. */
  onResync?: () => void;
}

export function useExpandJob(jobId: string | null, handlers: ExpandJobHandlers): void {
  useEffect(() => {
    if (!jobId) return;
    return connectJobStream({
      jobId,
      onResync: () => handlers.onResync?.(),
      onGiveUp: () =>
        handlers.onError(
          "stream_lost",
          "Lost connection while composing. Your progress is saved — check your connection and try again.",
        ),
      onFrame: (evt: JobFrame) => {
        if (evt.type === "token" && typeof evt.delta === "string") {
          handlers.onToken?.(evt.delta);
        } else if (evt.type === "stage" && typeof evt.name === "string") {
          if (evt.name.startsWith("section:start:")) {
            handlers.onSectionStart(evt.name.slice("section:start:".length));
          } else if (evt.name.startsWith("section:done:")) {
            handlers.onSectionDone(evt.name.slice("section:done:".length));
          }
        } else if (evt.type === "complete") {
          handlers.onComplete(
            evt.result as { draft_id: string; sections_done: number; sections_failed: number },
          );
        } else if (evt.type === "error") {
          handlers.onError(String(evt.code), String(evt.message), evt.hint as string | undefined);
        }
      },
    });
  }, [jobId, handlers]);
}
