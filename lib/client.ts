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
