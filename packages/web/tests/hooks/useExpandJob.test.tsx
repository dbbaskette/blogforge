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
});
