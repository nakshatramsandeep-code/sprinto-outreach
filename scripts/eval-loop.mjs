// Runs the feedback-loop simulation against a running app and sets a non-zero exit code if any gate fails.
// Usage: npm run eval:loop            (local, http://localhost:3000)
//        npm run eval:loop -- https://your-app.vercel.app
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const headers = { "content-type": "application/json", ...(process.env.ACCESS_KEY ? { "x-access-key": process.env.ACCESS_KEY } : {}) };
const show = (g) => (/%|pts/.test(g.threshold) ? `${Math.round(g.value * 1000) / 10}${g.threshold.includes("pts") ? " pts" : "%"}` : String(g.value));

async function main() {
  const res = await fetch(`${base}/api/evals/run`, { method: "POST", headers, body: JSON.stringify({ kind: "loop", note: "cli" }) });
  const r = await res.json();
  if (!res.ok) { console.error("failed:", r.error); return 2; }
  console.log(`Feedback-loop simulation #${r.runId}: ${r.weights.seeds} seeds per world`);
  console.log(`  weights   corr ${r.weights.signal.meanCorrBefore} -> ${r.weights.signal.meanCorrAfter} (250 emails) -> ${r.weightsLong.signal.meanCorrAfter} (600 emails); ceiling ${r.weights.signal.meanCorrCeiling}`);
  console.log(`  edits     edit rate ${Math.round(r.edits.withFlaw.editRateBefore * 100)}% -> ${Math.round(r.edits.withFlaw.editRateAfter * 100)}%`);
  console.log(`  contacts  agreement ${Math.round(r.contacts.preference.agreementBefore * 100)}% -> ${Math.round(r.contacts.preference.agreementAfter * 100)}%`);
  for (const g of r.gates) console.log(`  [${g.pass ? "pass" : "FAIL"}] ${g.name}: ${show(g)} (needs ${g.threshold})`);
  return r.allPass ? 0 : 1;
}
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 2; });
