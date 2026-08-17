import { describe, expect, it } from "vitest";

import type { ApiError } from "../../src/api/client";
import { presentError } from "../../src/lib/errors";

function apiError(status: number, code?: string): ApiError {
  return Object.assign(new Error("Technical message"), { status, code });
}

describe("presentError", () => {
  it("explains validation failures without exposing response details", () => {
    expect(presentError(apiError(422), "saving your draft")).toMatchObject({
      title: "Check the information",
      explanation: "Some information needs attention before saving your draft.",
      preservation: "Your work is still here.",
      action: "retry",
    });
  });

  it("directs provider setup and provider rejections to Settings", () => {
    expect(
      presentError(apiError(400, "provider_missing_key"), "creating an outline"),
    ).toMatchObject({
      title: "Check your AI provider",
      action: "settings",
    });
    expect(
      presentError(apiError(502, "provider_missing_key"), "creating an outline"),
    ).toMatchObject({
      title: "Check your AI provider",
      action: "settings",
    });
    expect(
      presentError(apiError(502, "provider_rejected_request"), "creating an outline"),
    ).toMatchObject({
      title: "Check your AI provider",
      action: "settings",
    });
  });

  it("keeps transient provider throttling and timeouts retryable", () => {
    expect(presentError(apiError(429, "provider_rate_limit"), "checking claims")).toMatchObject({
      action: "retry",
    });
    expect(presentError(apiError(504, "provider_timeout"), "checking claims")).toMatchObject({
      action: "retry",
    });
  });

  it("recommends reloading after a conflict", () => {
    expect(presentError(apiError(409, "publish_conflict"), "publishing your draft")).toMatchObject({
      title: "This changed somewhere else",
      action: "reload",
    });
  });

  it("asks the writer to sign in when their session has expired", () => {
    expect(presentError(apiError(401, "session_revoked"), "loading your draft")).toMatchObject({
      title: "Sign in again",
      action: "sign-in",
    });
  });

  it("makes service and unknown failures safe and recoverable", () => {
    expect(presentError(apiError(503), "running review")).toMatchObject({
      title: "The service is unavailable",
      action: "retry",
    });
    expect(presentError(new Error("socket reset"), "running review")).toMatchObject({
      title: "Something went wrong",
      action: "retry",
    });
  });
});
