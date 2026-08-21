import { api } from "../api/client";

/**
 * Resilient SSE job stream shared by every job subscriber.
 *
 * Frames arrive as JSON on a single `message` channel:
 *   {type:"token", delta:"…"}
 *   {type:"stage", name:"…", progress?:number}
 *   {type:"complete", result:…}
 *   {type:"error", code, message, hint?}
 *
 * On a dropped connection the stream reconnects with exponential backoff
 * (after checking the job's status — a job that finished or vanished while
 * we were offline is resolved directly instead of replayed forever). Before
 * each reconnect `onResync` fires: the server replays a snapshot that
 * re-sends the full accumulated text, so consumers must clear any local
 * buffers there to avoid duplicated content.
 */
export interface JobFrame {
  type: string;
  [k: string]: unknown;
}

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

interface JobSnapshot {
  status: string;
  result?: unknown;
  error?: { code?: string; message?: string; hint?: string };
}

export interface JobStreamOptions {
  jobId: string;
  onFrame: (frame: JobFrame) => void;
  /** Connection re-established after a drop; clear accumulated buffers. */
  onResync?: () => void;
  /** Every reconnection attempt failed. */
  onGiveUp?: () => void;
}

export function connectJobStream(options: JobStreamOptions): () => void {
  const { jobId, onFrame, onResync, onGiveUp } = options;
  let es: EventSource | null = null;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let opened = false;

  const stop = (): void => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    es?.close();
    es = null;
  };

  const open = (): void => {
    if (closed) return;
    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    es = source;
    if (opened) onResync?.();
    opened = true;
    source.onmessage = (e) => {
      retries = 0;
      let frame: JobFrame;
      try {
        frame = JSON.parse(e.data as string) as JobFrame;
      } catch {
        return; // ignore malformed frames
      }
      onFrame(frame);
      if (frame.type === "complete" || frame.type === "error") stop();
    };
    source.onerror = () => {
      if (closed) return;
      source.close();
      es = null;
      retries += 1;
      if (retries > MAX_RETRIES) {
        stop();
        onGiveUp?.();
        return;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** (retries - 1), MAX_DELAY_MS);
      timer = setTimeout(() => void reconnect(), delay);
    };
  };

  const deliverTerminal = (job: JobSnapshot): void => {
    if (job.status === "succeeded") {
      onFrame({ type: "complete", result: job.result ?? {} });
    } else {
      onFrame({
        type: "error",
        code: job.error?.code ?? (job.status === "cancelled" ? "cancelled" : "job_failed"),
        message: job.error?.message ?? "Job ended.",
        hint: job.error?.hint,
      });
    }
  };

  const reconnect = async (): Promise<void> => {
    if (closed) return;
    try {
      const job = await api<JobSnapshot>(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (closed) return;
      if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
        stop();
        deliverTerminal(job);
        return;
      }
    } catch (e) {
      if (closed) return;
      if ((e as { status?: number }).status === 404) {
        stop();
        onFrame({
          type: "error",
          code: "job_not_found",
          message: "This job is no longer running.",
        });
        return;
      }
      // Network error — fall through and keep retrying.
    }
    open();
  };

  open();
  return stop;
}
