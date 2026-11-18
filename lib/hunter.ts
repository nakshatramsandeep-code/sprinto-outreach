import { CONFIG } from "./config";
import { q } from "./db";
import type { HunterPerson } from "./rank";

export class HunterQuotaError extends Error {}

const monthKey = () => `hunter:${new Date().toISOString().slice(0, 7)}`;

export async function hunterUsed(): Promise<number> {
  const r = await q<{ value: number }>("SELECT value FROM counters WHERE key=$1", [monthKey()]);
  return r[0]?.value ?? 0;
}

// Reserve one search BEFORE calling, so a crash can never let us exceed the free tier.
async function reserve(): Promise<boolean> {
  const r = await q<{ value: number }>(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
     WHERE counters.value < $2
     RETURNING value`,
    [monthKey(), CONFIG.budget.hunterMonthlyLimit],
  );
  return r.length > 0;
}

export async function hunterDomainSearch(domain: string): Promise<HunterPerson[]> {
  if (!process.env.HUNTER_API_KEY) throw new Error("HUNTER_API_KEY is not set");
  if (!(await reserve())) throw new HunterQuotaError("monthly Hunter limit reached");

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=${CONFIG.budget.hunterResultLimit}`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": process.env.HUNTER_API_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429 || res.status === 402) throw new HunterQuotaError(`hunter returned ${res.status}`);
  if (!res.ok) throw new Error(`hunter error ${res.status}`);
  const json = (await res.json()) as {
    data?: { emails?: Array<{ value: string; first_name: string | null; last_name: string | null; position: string | null; seniority: string | null; department: string | null; confidence: number | null; verification?: { status?: string | null } }> };
  };
  return (json.data?.emails ?? []).map((e) => ({
    email: e.value,
    first_name: e.first_name,
    last_name: e.last_name,
    position: e.position,
    seniority: e.seniority,
    department: e.department,
    confidence: e.confidence,
    verified: e.verification?.status === "valid",
  }));
}
