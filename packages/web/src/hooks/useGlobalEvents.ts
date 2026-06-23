import { useEffect } from "react";

export interface GlobalEvent {
  type: "draft:created" | "draft:updated" | "draft:deleted";
  id?: string;
  [key: string]: unknown;
}

const RECONNECT_DELAY_MS = 3000;

export function useGlobalEvents(onEvent: (evt: GlobalEvent) => void): void {
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.onmessage = (e) => {
        try {
          onEvent(JSON.parse(e.data) as GlobalEvent);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        // Transient network blips fire onerror; tear down the broken stream and
        // schedule a fresh connection rather than going silently stale forever.
        es?.close();
        es = null;
        if (closed || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, RECONNECT_DELAY_MS);
      };
    };

    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      // Refresh on refocus so a tab that slept through events catches up.
      onEvent({ type: "draft:updated" });
      // If the stream died while hidden, reconnect immediately.
      if (es === null && reconnectTimer === null && !closed) connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [onEvent]);
}
