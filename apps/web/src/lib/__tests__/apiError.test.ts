import { describe, it, expect } from "vitest";
import { parseApiError } from "../api";

describe("parseApiError", () => {
  it("surfaces retry timing for upstream ORS 429 when available", () => {
    const parsed = parseApiError(429, {
      detail: "The routing service is busy. Try again shortly.",
      error_type: "ors_rate_limited",
      retry_after_seconds: 7,
    }, "Route failed: 429");

    expect(parsed.message).toBe("The routing service is busy. Try again in 7s.");
    expect(parsed.retryAfterSeconds).toBe(7);
  });

  it("gives non-generic copy for upstream ORS 429 without retry timing", () => {
    const parsed = parseApiError(429, {
      detail: "The routing service is busy. Try again shortly.",
      error_type: "ors_rate_limited",
    }, "Route failed: 429");

    expect(parsed.message).toBe("The routing service is busy. Try again shortly.");
    expect(parsed.retryAfterSeconds).toBeUndefined();
  });

  it("marks upstream 5xx as service trouble, not a problem with the route", () => {
    const parsed = parseApiError(503, {
      detail: "The routing service is temporarily unavailable. Try again in a moment.",
      error_type: "ors_upstream",
    }, "Route failed: 503");

    expect(parsed.message).toBe(
      "The routing service is temporarily unavailable. Try again in a moment.",
    );
    expect(parsed.retryAfterSeconds).toBeUndefined();
  });

  it("preserves Detour's own rate-limit handling exactly", () => {
    // Local 429s have no error_type; their detail passes through untouched
    // and retry_after_seconds still feeds the countdown copy in VerdictPanel.
    const parsed = parseApiError(429, {
      detail: "Rate limit exceeded. Try again shortly.",
      retry_after_seconds: 31,
    }, "Route failed: 429");

    expect(parsed.message).toBe("Rate limit exceeded. Try again shortly.");
    expect(parsed.retryAfterSeconds).toBe(31);
  });

  it("uses a string detail as the message for other errors", () => {
    const parsed = parseApiError(404, { detail: "No route found" }, "Route failed: 404");
    expect(parsed.message).toBe("No route found");
    expect(parsed.retryAfterSeconds).toBeUndefined();
  });

  it("falls back when the body is not JSON", () => {
    const parsed = parseApiError(502, null, "Route failed: 502");
    expect(parsed.message).toBe("Route failed: 502");
  });

  it("falls back when detail is a structured object", () => {
    const parsed = parseApiError(422, { detail: [{ msg: "bad" }] }, "Route failed: 422");
    expect(parsed.message).toBe("Route failed: 422");
  });
});
