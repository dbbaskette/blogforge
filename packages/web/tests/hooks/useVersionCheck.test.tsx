import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVersionCheck } from "../../src/hooks/useVersionCheck";

function healthResponse(version: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => ({ status: "ok", version }),
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useVersionCheck", () => {
  it("flips stale when the server version changes across polls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthResponse("1.0.0"))
      .mockResolvedValue(healthResponse("1.1.0"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useVersionCheck(1000));

    // Let the initial fetch settle — it records the baseline version.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(false);

    // Advance past the interval so a second poll runs with a new version.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.stale).toBe(true);
  });

  it("stays fresh while the version is unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthResponse("1.0.0"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useVersionCheck(1000));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.stale).toBe(false);
  });
});
