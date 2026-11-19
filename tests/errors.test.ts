import { describe, it, expect } from "vitest";
import { friendlyError } from "../lib/errors";

describe("friendlyError", () => {
  it("turns a raw Gemini JSON error into one plain sentence", () => {
    const raw = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
    expect(friendlyError(new Error(raw))).toBe("AI service rejected our API key (check GEMINI_API_KEY)");
  });
  it("recognises rate limits, timeouts and outages", () => {
    expect(friendlyError(new Error("429 RESOURCE_EXHAUSTED quota exceeded"))).toMatch(/rate-limiting/);
    expect(friendlyError(new Error("Deadline expired before operation could complete"))).toBe("Timed out, retry");
    expect(friendlyError(new Error("This operation was aborted"))).toBe("Timed out, retry");
    expect(friendlyError(new Error("503 Service Unavailable"))).toMatch(/unavailable/);
  });
  it("turns the exact raw 504 blob that was shown in the Accounts table into a short message", () => {
    const blob = '{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}';
    expect(friendlyError(blob)).toBe("Timed out, retry");
    expect(friendlyError("network_error")).toBe("Could not reach the site, retry");
  });
  it("keeps unknown errors short and readable", () => {
    const out = friendlyError(new Error("x".repeat(500)));
    expect(out.length).toBeLessThanOrEqual(160);
    expect(friendlyError("plain string")).toBe("plain string");
  });
});
