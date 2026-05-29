import { useEffect } from "react";

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
}

export function useExpandJob(jobId: string | null, handlers: ExpandJobHandlers): void {
  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as { type: string; [k: string]: unknown };
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
          es.close();
        } else if (evt.type === "error") {
          handlers.onError(String(evt.code), String(evt.message), evt.hint as string | undefined);
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId, handlers]);
}
