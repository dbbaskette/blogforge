import "@testing-library/jest-dom";
import { vi } from "vitest";

// Node 25 ships a built-in localStorage stub that vitest's jsdom environment
// does not override (it's not in its known-keys list). Pull the real Storage
// implementation from the jsdom window vitest attaches to `globalThis.jsdom`.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  Object.defineProperty(globalThis, "localStorage", {
    get: () => jsdomWindow.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    get: () => jsdomWindow.sessionStorage,
    configurable: true,
  });
}

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

// jsdom does not implement scrollIntoView; panels that scroll a highlighted
// passage into view (HumanizePanel, OptimizePanel) call it from an effect.
// Stub it so those effects don't throw an unhandled error during tests.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

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
