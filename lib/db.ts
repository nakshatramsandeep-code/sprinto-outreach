import { neon } from "@neondatabase/serverless";
import { AsyncLocalStorage } from "node:async_hooks";

let _sql: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

// ---- per-request database timing (reported to the browser in a Server-Timing header, see lib/api.ts) ----
export type DbStats = { trips: number; ms: number };
export const dbStats = new AsyncLocalStorage<DbStats>();
async function timed<T>(fn: () => Promise<T>): Promise<T> {
  const s = dbStats.getStore();
  if (!s) return fn();
  const t0 = performance.now();
  try { return await fn(); } finally { s.trips++; s.ms += performance.now() - t0; }
}

// One query, one network round trip.
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return timed(async () => (await sql().query(text, params)) as unknown as T[]);
}

/**
 * Several READ queries in ONE round trip (one HTTP request, one read-only transaction).
 * Every extra sequential query costs a full network round trip to the database, so a page that needs
 * 12 numbers should ask for them together. Results come back in the same order as the queries.
 * Never put writes in here.
 */
export type Query = [text: string, params?: unknown[]];
export async function qm(queries: Query[]): Promise<Record<string, any>[][]> {
  if (queries.length === 0) return [];
  if (queries.length === 1) return [await q(queries[0][0], queries[0][1] ?? [])];
  return timed(async () => (await sql().transaction((txn) => queries.map(([t, p]) => txn.query(t, p ?? [])), { readOnly: true })) as unknown as Record<string, any>[][]);
}

export async function logStep(
  companyId: number | null,
  step: string,
  detail: Record<string, unknown>,
  tokens = 0,
) {
  await q("INSERT INTO steps (company_id, step, detail, tokens) VALUES ($1,$2,$3,$4)", [
    companyId,
    step,
    JSON.stringify(detail),
    tokens,
  ]);
}
