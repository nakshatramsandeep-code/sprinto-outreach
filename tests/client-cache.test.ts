import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCached, prefetch, peek, invalidate, PAGE_DATA } from "../lib/client";

// The browser-side cache is why moving between pages feels instant. These prove it never asks twice for the same thing,
// serves stale data immediately, and never caches a failure.
let calls: string[] = [];
let respond: (path: string) => Promise<Response>;
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => {
  calls = []; invalidate();
  respond = (p) => ok({ path: p, n: calls.length });
  vi.stubGlobal("fetch", (url: string) => { calls.push(url); return respond(url); });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("client data cache", () => {
  it("two simultaneous requests for the same data make ONE network call", async () => {
    const [a, b] = await Promise.all([fetchCached("/api/home"), fetchCached("/api/home")]);
    expect(calls).toEqual(["/api/home"]);
    expect(a).toBe(b);
  });

  it("peek returns the last data instantly after a load (the stale-while-revalidate part)", async () => {
    expect(peek("/api/home")).toBeNull();
    await fetchCached("/api/home");
    expect(peek("/api/home")).toMatchObject({ path: "/api/home" });
  });

  it("prefetch loads in the background and does not repeat while the data is fresh", async () => {
    prefetch("/api/review", 20_000);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    prefetch("/api/review", 20_000);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);                       // still fresh: no second call
    vi.advanceTimersByTime(25_000);
    prefetch("/api/review", 20_000);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);                       // stale: refreshed
  });

  it("a failed request is not cached and can be retried", async () => {
    respond = () => Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    await expect(fetchCached("/api/home")).rejects.toThrow("boom");
    expect(peek("/api/home")).toBeNull();
    respond = (p) => ok({ path: p });
    await fetchCached("/api/home");
    expect(calls).toHaveLength(2);
    expect(peek("/api/home")).toMatchObject({ path: "/api/home" });
  });

  it("prefetch swallows errors (a background warm-up must never break the page)", async () => {
    respond = () => Promise.resolve(new Response("{}", { status: 500 }));
    expect(() => prefetch("/api/home")).not.toThrow();
    await vi.runAllTimersAsync();
  });

  it("invalidate drops cached data", async () => {
    await fetchCached("/api/home");
    invalidate("/api/home");
    expect(peek("/api/home")).toBeNull();
  });

  it("every nav page has a data endpoint to warm", () => {
    for (const p of ["/", "/review", "/outreach", "/pipeline", "/discover", "/accounts", "/analytics", "/evals", "/learn", "/rules", "/settings"]) {
      expect(PAGE_DATA[p], p).toMatch(/^\/api\//);
    }
  });
});
