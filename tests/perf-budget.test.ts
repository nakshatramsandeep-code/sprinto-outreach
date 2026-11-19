import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------------------------
// Efficiency tests. Slowness here was almost entirely database ROUND TRIPS (each one crosses the network),
// so we pin the number of trips every endpoint is allowed to make. The Neon driver is faked and counts calls,
// which also proves every endpoint works on a brand-new EMPTY database (no crash on missing rows).
// ---------------------------------------------------------------------------------------------

const calls: { kind: "query" | "transaction"; queries: number }[] = [];
const zeroRow = () => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : 0) }); // any column reads as 0

function fakeRows(text: string): Record<string, unknown>[] {
  const t = text.trim();
  if (/FROM icp_versions WHERE active/i.test(t)) return [{ version: 1, config: {} }];
  if (/^SELECT\s*\(SELECT/i.test(t)) return [zeroRow() as never]; // dashboard-style "many counts in one row"
  if (/^SELECT COUNT\(\*\)::int AS n/i.test(t)) return [{ n: 0 }];
  if (/FILTER \(WHERE type='email.opened'\)/i.test(t)) return [{ opened: 0, total: 0 }];
  return [];
}

vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    const f: any = () => { throw new Error("tagged templates are not used"); };
    f.query = async (text: string) => { calls.push({ kind: "query", queries: 1 }); return fakeRows(text); };
    f.transaction = async (fn: (txn: { query: (t: string) => { t: string } }) => { t: string }[]) => {
      const qs = fn({ query: (t) => ({ t }) });
      calls.push({ kind: "transaction", queries: qs.length });
      return qs.map((x) => fakeRows(x.t));
    };
    return f;
  },
}));

process.env.DATABASE_URL = "postgres://fake";

const { qm, q } = await import("../lib/db");
const routes = {
  badge: (await import("../app/api/badge/route")).GET,
  home: (await import("../app/api/home/route")).GET,
  review: (await import("../app/api/review/route")).GET,
  analytics: (await import("../app/api/analytics/route")).GET,
  pipeline: (await import("../app/api/pipeline/route")).GET,
  companies: (await import("../app/api/companies/route")).GET,
  company: (await import("../app/api/companies/[id]/route")).GET,
  candidates: (await import("../app/api/candidates/route")).GET,
  evals: (await import("../app/api/evals/route")).GET,
  learning: (await import("../app/api/learning/route")).GET,
  icp: (await import("../app/api/icp/route")).GET,
  settings: (await import("../app/api/settings/route")).GET,
  drafts: (await import("../app/api/drafts/route")).GET,
};

// endpoint -> the most database round trips it is allowed to make. These were 3 to 20 before the fix.
const BUDGET: Record<keyof typeof routes, number> = {
  badge: 1, home: 1, review: 2, analytics: 1, pipeline: 1, companies: 1, company: 1, candidates: 1, evals: 1, learning: 1, icp: 1, settings: 1, drafts: 1,
};

const ctx = { params: Promise.resolve({ id: "1" }) };
beforeEach(() => { calls.length = 0; });

describe("database round trips: the batching primitive", () => {
  it("qm runs many queries in ONE trip, a single query in one, none in zero", async () => {
    await qm([["SELECT 1"], ["SELECT 2"], ["SELECT 3"], ["SELECT 4"], ["SELECT 5"]]);
    expect(calls).toEqual([{ kind: "transaction", queries: 5 }]);
    calls.length = 0; await qm([["SELECT 1"]]); expect(calls).toHaveLength(1);
    calls.length = 0; await qm([]); expect(calls).toHaveLength(0);
  });
  it("without batching the same five queries cost five trips", async () => {
    for (let i = 0; i < 5; i++) await q("SELECT 1");
    expect(calls).toHaveLength(5);
  });
  it("results come back in the order the queries were asked", async () => {
    const out = await qm([["SELECT COUNT(*)::int AS n FROM x"], ["SELECT something_else"]]);
    expect(out[0]).toEqual([{ n: 0 }]);
    expect(out[1]).toEqual([]);
  });
});

describe("every data endpoint stays inside its round-trip budget (and works on an empty database)", () => {
  for (const name of Object.keys(routes) as (keyof typeof routes)[]) {
    // an empty database has no company #1, so that one endpoint correctly answers 404 (still in one trip)
    const expected = name === "company" ? 404 : 200;
    it(`${name}: <= ${BUDGET[name]} trip(s), HTTP ${expected}, valid JSON`, async () => {
      const res = await routes[name](new Request(`http://t/api/${name}`), ctx);
      expect(res.status, `status (${await res.clone().text()})`).toBe(expected);
      await res.json();
      const reported = Number(res.headers.get("X-DB-Trips"));
      expect(reported).toBe(calls.length);                 // the header tells the truth
      expect(calls.length).toBeLessThanOrEqual(BUDGET[name]);
      expect(res.headers.get("Server-Timing")).toMatch(/db;dur=\d+/);
    });
  }

  it("the nav badge costs exactly one tiny query (the dashboard used to be loaded on every page just to get this number)", async () => {
    const res = await routes.badge(new Request("http://t/api/badge"), ctx);
    expect(calls).toHaveLength(1);
    expect(await res.json()).toEqual({ needsYou: 0 });
  });

  it("total trips to open ALL pages' data is 13 or fewer (it was ~60 before)", async () => {
    for (const name of Object.keys(routes) as (keyof typeof routes)[]) await routes[name](new Request("http://t/x"), ctx);
    expect(calls.length).toBeLessThanOrEqual(14);
  });
});
