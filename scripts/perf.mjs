// Performance check against a running app. Every data endpoint is called several times; we report the median and slowest
// response time, how many database round trips it used (from the X-DB-Trips header) and the payload size, and compare each
// to a budget. Exits non-zero if any budget is broken, so it can gate a release.
//
// Usage: npm run perf                              (local, http://localhost:3000)
//        npm run perf -- https://your-app.vercel.app
// Env:   PERF_MEDIAN_MS (default 600), PERF_P90_MS (default 1500), PERF_RUNS (default 10)
// We judge the 90th percentile, not the single slowest call: one network hiccup should not fail a release, a consistently slow endpoint should.
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const RUNS = Number(process.env.PERF_RUNS || 10);
const MEDIAN = Number(process.env.PERF_MEDIAN_MS || 600), P90 = Number(process.env.PERF_P90_MS || 1500);
const headers = process.env.ACCESS_KEY ? { "x-access-key": process.env.ACCESS_KEY } : {};

// path, max database round trips, max payload KB
const BUDGETS = [
  ["/api/badge", 1, 2], ["/api/home", 1, 30], ["/api/review", 2, 80], ["/api/analytics", 1, 10], ["/api/pipeline", 1, 40], ["/api/companies", 1, 80],
  ["/api/candidates", 1, 80], ["/api/evals", 1, 60], ["/api/learning", 1, 20], ["/api/icp", 1, 10], ["/api/settings", 1, 15], ["/api/drafts", 1, 60],
];

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
let failed = 0;
console.log(`Performance check: ${base}  (${RUNS} calls each; budgets: median <= ${MEDIAN}ms, p90 <= ${P90}ms)\n`);
console.log("endpoint".padEnd(18) + "median".padStart(8) + "p90".padStart(9) + "  trips".padStart(7) + "     KB".padStart(8) + "   result");
await fetch(`${base}/api/badge`, { headers }).catch(() => {}); // warm up (cold start / first connection) so it does not skew the first row

for (const [path, maxTrips, maxKb] of BUDGETS) {
  const t = []; let trips = null, kb = 0, status = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = await fetch(base + path, { headers });
    const body = await res.arrayBuffer();
    t.push(performance.now() - t0); status = res.status; kb = body.byteLength / 1024; trips = Number(res.headers.get("x-db-trips") ?? NaN);
  }
  const med = Math.round(pct(t, 0.5)), slow = Math.round(pct(t, 0.9));
  const problems = [];
  if (status !== 200) problems.push(`HTTP ${status}`);
  if (med > MEDIAN) problems.push(`median ${med}ms > ${MEDIAN}`);
  if (slow > P90) problems.push(`p90 ${slow}ms > ${P90}`);
  if (Number.isFinite(trips) && trips > maxTrips) problems.push(`${trips} DB trips > ${maxTrips}`);
  if (kb > maxKb) problems.push(`${kb.toFixed(1)}KB > ${maxKb}KB`);
  if (problems.length) failed++;
  console.log(path.padEnd(18) + `${med}ms`.padStart(8) + `${slow}ms`.padStart(9) + String(Number.isFinite(trips) ? trips : "?").padStart(7) + kb.toFixed(1).padStart(8) + "   " + (problems.length ? "FAIL: " + problems.join("; ") : "ok"));
}
console.log(failed ? `\n${failed} endpoint(s) over budget` : "\nAll endpoints within budget");
process.exitCode = failed ? 1 : 0; // (not process.exit(): on Windows that can crash Node with open network handles)
