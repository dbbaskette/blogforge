import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStreamJob } from "../../src/hooks/useStreamJob";

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

describe("useStreamJob", () => {
  it("does nothing when jobId is null", () => {
    renderHook(() => useStreamJob(null, { onDelta: vi.fn() }));
    expect(created.length).toBe(0);
  });

  it("opens an EventSource for the given jobId", () => {
    renderHook(() => useStreamJob("job-1", {}));
    expect(created.length).toBe(1);
    expect(created[0].url).toContain("job-1");
  });

  it("invokes onDelta on token frames", () => {
    const onDelta = vi.fn();
    renderHook(() => useStreamJob("j", { onDelta }));
    send(created[0], { type: "token", delta: "hello" });
    send(created[0], { type: "token", delta: " world" });
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, "hello");
    expect(onDelta).toHaveBeenNthCalledWith(2, " world");
  });

  it("invokes onResult and onDone on complete frames", () => {
    const onResult = vi.fn();
    const onDone = vi.fn();
    renderHook(() => useStreamJob("j", { onResult, onDone }));
    send(created[0], { type: "complete", result: { foo: 42 } });
    expect(onResult).toHaveBeenCalledWith({ foo: 42 });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("invokes onError on error frames", () => {
    const onError = vi.fn();
    renderHook(() => useStreamJob("j", { onError }));
    send(created[0], { type: "error", code: "bad_thing", message: "oops" });
    expect(onError).toHaveBeenCalledTimes(1);
    const arg = onError.mock.calls[0][0] as Error & { code?: string };
    expect(arg.message).toContain("oops");
    expect(arg.code).toBe("bad_thing");
  });

  it("ignores unknown event types without crashing", () => {
    const onDelta = vi.fn();
    renderHook(() => useStreamJob("j", { onDelta }));
    send(created[0], { type: "stage", name: "thinking" });
    send(created[0], { type: "weird" });
    expect(onDelta).not.toHaveBeenCalled();
  });
});
