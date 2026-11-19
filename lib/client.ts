"use client";

export const getKey = () => {
  try { return sessionStorage.getItem("access_key") ?? ""; } catch { return ""; }
};
export const setKey = (k: string) => {
  try { sessionStorage.setItem("access_key", k); } catch {}
};

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-access-key": getKey() },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
  return json as T;
}

// ---- stale-while-revalidate cache for page data ----
// Pages show the last data they had INSTANTLY, then refresh in the background. Moving between pages no longer
// waits for the network, and hovering a nav link (or the idle warm-up in Nav) loads that page's data before you click.
const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();

export const peek = <T,>(path: string): T | null => (cache.get(path)?.data as T) ?? null;

export function fetchCached<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>; // never ask for the same thing twice at once
  const p = api<T>(path).then((d) => { cache.set(path, { data: d, at: Date.now() }); return d; }).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export function prefetch(path: string, maxAgeMs = 20_000) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < maxAgeMs) return;
  void fetchCached(path).catch(() => {});
}

export const invalidate = (path?: string) => { if (path) cache.delete(path); else cache.clear(); };

// Which API each page loads first (used for hover/idle prefetch).
export const PAGE_DATA: Record<string, string> = {
  "/": "/api/home", "/review": "/api/review", "/outreach": "/api/drafts", "/pipeline": "/api/pipeline", "/discover": "/api/candidates",
  "/accounts": "/api/companies", "/analytics": "/api/analytics", "/evals": "/api/evals", "/learn": "/api/learning", "/rules": "/api/icp", "/settings": "/api/settings",
};
