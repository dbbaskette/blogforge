import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addTextSample, getVoiceProfile, setExemplar } from "../../src/api/voice";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchStub(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("voice API module", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("getVoiceProfile() calls GET /api/voice", async () => {
    const stub = makeFetchStub({ id: "vp1", samples: [] });
    globalThis.fetch = stub;

    const result = await getVoiceProfile();

    expect(stub).toHaveBeenCalledOnce();
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice");
    expect(init?.method ?? "GET").toBe("GET");
    expect((result as { id: string }).id).toBe("vp1");
  });

  it("addTextSample({name, text}) POSTs to /api/voice/samples/text with JSON body", async () => {
    const stub = makeFetchStub({ id: "s1", kind: "text", name: "s", status: "ready" });
    globalThis.fetch = stub;

    await addTextSample({ name: "s", text: "t" });

    expect(stub).toHaveBeenCalledOnce();
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice/samples/text");
    expect(init?.method).toBe("POST");
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({ name: "s", text: "t" });
  });

  it("setExemplar('id1', true) PUTs to /api/voice/samples/id1/exemplar", async () => {
    const stub = makeFetchStub({ id: "vp1", samples: [] });
    globalThis.fetch = stub;

    await setExemplar("id1", true);

    expect(stub).toHaveBeenCalledOnce();
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice/samples/id1/exemplar");
    expect(init?.method).toBe("PUT");
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({ exemplar: true });
  });
});
