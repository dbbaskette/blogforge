import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ExpandJobHandlers, useExpandJob } from "../../src/hooks/useExpandJob";

interface FakeES {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  close: () => void;
}

const created: FakeES[] = [];

beforeEach(() => {
  created.length = 0;
  class FakeEventSource {
    url: string;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      created.push(this as unknown as FakeES);
    }
    close(): void {}
  }
  Object.defineProperty(window, "EventSource", {
    writable: true,
    configurable: true,
    value: FakeEventSource,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function send(es: FakeES, data: unknown): void {
  es.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
}

function handlers(over: Partial<ExpandJobHandlers> = {}): ExpandJobHandlers {
  return {
    onSectionStart: vi.fn(),
    onSectionDone: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
}

describe("useExpandJob", () => {
  it("dispatches token frames to onToken", () => {
    const onToken = vi.fn();
    renderHook(() => useExpandJob("job-1", handlers({ onToken })));
    send(created[0], { type: "token", delta: "Hello" });
    send(created[0], { type: "token", delta: ", world" });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenNthCalledWith(1, "Hello");
    expect(onToken).toHaveBeenNthCalledWith(2, ", world");
  });

  it("still routes stage and complete frames", () => {
    const onSectionStart = vi.fn();
    const onComplete = vi.fn();
    renderHook(() => useExpandJob("j", handlers({ onSectionStart, onComplete })));
    send(created[0], { type: "stage", name: "section:start:s1" });
    send(created[0], {
      type: "complete",
      result: { draft_id: "d", sections_done: 1, sections_failed: 0 },
    });
    expect(onSectionStart).toHaveBeenCalledWith("s1");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not crash when onToken is omitted", () => {
    renderHook(() => useExpandJob("j", handlers()));
    expect(() => send(created[0], { type: "token", delta: "x" })).not.toThrow();
  });

  it("closes the stream after an error frame", () => {
    const onError = vi.fn();
    renderHook(() => useExpandJob("j", handlers({ onError })));
    const closeSpy = vi.spyOn(created[0], "close");
    send(created[0], { type: "error", code: "provider_error", message: "boom" });
    expect(onError).toHaveBeenCalledWith("provider_error", "boom", undefined);
    expect(closeSpy).toHaveBeenCalled();
  });

  it("reconnects after a dropped connection and fires onResync", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onResync = vi.fn();
      renderHook(() => useExpandJob("j", handlers({ onResync })));
      created[0].onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(1000);
      // A fresh EventSource replaced the dropped one.
      expect(created.length).toBe(2);
      expect(fetchMock).toHaveBeenCalled();
      expect(onResync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("resolves a job that finished while disconnected without reopening", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "succeeded",
          result: { draft_id: "d", sections_done: 2, sections_failed: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onComplete = vi.fn();
      renderHook(() => useExpandJob("j", handlers({ onComplete })));
      created[0].onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(created.length).toBe(1); // no reconnect — job already done
      expect(onComplete).toHaveBeenCalledWith({
        draft_id: "d",
        sections_done: 2,
        sections_failed: 0,
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("surfaces job_not_found when the job vanished (evicted) mid-stream", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("HTTP 404"), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onError = vi.fn();
      renderHook(() => useExpandJob("j", handlers({ onError })));
      created[0].onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(created.length).toBe(1); // no reconnect
      expect(onError).toHaveBeenCalledWith(
        "job_not_found",
        "This job is no longer running.",
        undefined,
      );
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
