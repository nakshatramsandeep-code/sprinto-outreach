import { describe, it, expect } from "vitest";
import { friendlyError } from "../lib/errors";

describe("friendlyError", () => {
  it("turns a raw Gemini JSON error into one plain sentence", () => {
    const raw = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
    expect(friendlyError(new Error(raw))).toBe("the AI service rejected our API key (check GEMINI_API_KEY)");
  });
  it("recognises rate limits, timeouts and outages", () => {
    expect(friendlyError(new Error("429 RESOURCE_EXHAUSTED quota exceeded"))).toMatch(/rate-limiting/);
    expect(friendlyError(new Error("Deadline expired before operation could complete"))).toMatch(/timed out/);
    expect(friendlyError(new Error("503 Service Unavailable"))).toMatch(/unavailable/);
  });
  it("keeps unknown errors short and readable", () => {
    const out = friendlyError(new Error("x".repeat(500)));
    expect(out.length).toBeLessThanOrEqual(160);
    expect(friendlyError("plain string")).toBe("plain string");
  });
});
