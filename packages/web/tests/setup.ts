import "@testing-library/jest-dom";
import { vi } from "vitest";

// Default no-op EventSource stub; tests can override per-spec.
class NoopEventSource {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close(): void {}
}
Object.defineProperty(window, "EventSource", {
  writable: true,
  configurable: true,
  value: NoopEventSource,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
