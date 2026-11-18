// Release gate: runs the extraction eval against a running app and exits non-zero if any gate fails or quality regressed.
// Usage: npm run eval                       (local, http://localhost:3000)
//        npm run eval -- https://your-app.vercel.app
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const headers = { "content-type": "application/json", ...(process.env.ACCESS_KEY ? { "x-access-key": process.env.ACCESS_KEY } : {}) };

const res = await fetch(`${base}/api/evals/run`, { method: "POST", headers, body: JSON.stringify({ kind: "extraction", note: "cli" }) });
const out = await res.json();
if (!res.ok) { console.error("eval failed:", out.error); process.exit(2); }

const m = out.metrics;
const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
console.log(`Extraction eval #${out.runId}: ${m.n} cases, ${m.avgTokens} tokens and ${(m.avgMs / 1000).toFixed(1)}s per case`);
console.log(`  certified: acc ${pct(m.certified.accuracy)}, recall ${pct(m.certified.recall)}, missed ${m.certified.fn}, wrongly flagged ${m.certified.fp}`);
console.log(`  B2B SaaS: acc ${pct(m.saas.accuracy)} (coverage ${pct(m.saas.coverage)})   stage: acc ${pct(m.stage.accuracy)}`);
let failed = false;
for (const g of out.gates) {
  const status = g.pass === null ? "SKIP (not enough labels)" : g.pass ? "pass" : "FAIL";
  if (g.pass === false) failed = true;
  console.log(`  [${status}] ${g.name}: ${pct(g.value)} (needs ${pct(g.threshold)})`);
}
for (const r of out.regressions) { failed = true; console.log(`  [REGRESSION] ${r}`); }
for (const f of out.failures) console.log(`  wrong: ${f.domain} expected ${JSON.stringify(f.expected)} got ${JSON.stringify(f.predicted)}`);
process.exit(failed ? 1 : 0);
