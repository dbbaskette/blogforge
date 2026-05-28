import { afterEach, describe, expect, it, vi } from "vitest";

import * as linkedin from "../../src/api/linkedin";

function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("linkedin API module", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the expected functions", () => {
    expect(typeof linkedin.getLinkedInStatus).toBe("function");
    expect(typeof linkedin.connectLinkedIn).toBe("function");
    expect(typeof linkedin.disconnectLinkedIn).toBe("function");
    expect(typeof linkedin.publishToLinkedIn).toBe("function");
    expect(typeof linkedin.listLinkedInPosts).toBe("function");
    expect(typeof linkedin.getLinkedInStats).toBe("function");
  });

  it("getLinkedInStatus GETs /linkedin/status with credentials", async () => {
    const fetchFn = mockFetch({ connected: false });
    const res = await linkedin.getLinkedInStatus();
    expect(res).toEqual({ connected: false });
    expect(fetchFn).toHaveBeenCalledWith(
      "/linkedin/status",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("connectLinkedIn GETs /linkedin/connect", async () => {
    const fetchFn = mockFetch({ authorize_url: "https://linkedin.com/oauth" });
    const res = await linkedin.connectLinkedIn();
    expect(res.authorize_url).toBe("https://linkedin.com/oauth");
    expect(fetchFn.mock.calls[0][0]).toBe("/linkedin/connect");
  });

  it("disconnectLinkedIn DELETEs /linkedin/connection", async () => {
    const fetchFn = mockFetch({}, 204);
    await linkedin.disconnectLinkedIn();
    expect(fetchFn).toHaveBeenCalledWith(
      "/linkedin/connection",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("publishToLinkedIn POSTs /linkedin/publish with a JSON body", async () => {
    const fetchFn = mockFetch({ post_urn: "urn:li:share:1", post_id: "p1" }, 201);
    const res = await linkedin.publishToLinkedIn({ text: "hello", visibility: "PUBLIC" });
    expect(res).toEqual({ post_urn: "urn:li:share:1", post_id: "p1" });
    const [path, init] = fetchFn.mock.calls[0];
    expect(path).toBe("/linkedin/publish");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: "hello", visibility: "PUBLIC" });
  });

  it("listLinkedInPosts GETs /linkedin/posts", async () => {
    const fetchFn = mockFetch([]);
    await linkedin.listLinkedInPosts();
    expect(fetchFn.mock.calls[0][0]).toBe("/linkedin/posts");
  });

  it("getLinkedInStats GETs /linkedin/stats/{id} url-encoded", async () => {
    const fetchFn = mockFetch({ likes: 3, comments: 1, fetched_at: "2026-05-28T00:00:00Z" });
    const res = await linkedin.getLinkedInStats("post 1");
    expect(res.likes).toBe(3);
    expect(fetchFn.mock.calls[0][0]).toBe("/linkedin/stats/post%201");
  });
});
